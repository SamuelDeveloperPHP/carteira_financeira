# Arquitetura e decisões

```text
Navegador → localhost:3080 / Nginx
                         ├── /       → Next.js (frontend)
                         └── /api/*  → NestJS → PostgreSQL
Operador local → comando controlado de depósito / provisionamento master
```

Gateway e PostgreSQL publicam portas limitadas a 127.0.0.1: 3080 para a aplicação e 5433 para acesso local pelo DBeaver. API e frontend usam apenas rede Docker privada. O gateway sobrescreve o cabeçalho de IP encaminhado, e a API confia em um único proxy. Em Docker Desktop, NAT pode fazer o IP observado corresponder ao intermediário local; ele não deve ser apresentado como identificação inequívoca de um telefone.

## Diagramas

### 1. Containers (Docker Compose)

```mermaid
flowchart LR
  user([Navegador]) -->|HTTP 127.0.0.1:3080| gw[Gateway Nginx<br/>cabeçalhos de segurança<br/>IP confiável]
  gw -->|"/"| web[Frontend Next.js<br/>React + SweetAlert2<br/>Leaflet + face-api.js]
  gw -->|"/api/*"| api[API NestJS<br/>usuário de banco wallet_app<br/>somente leitura/escrita mínima]
  api -->|SQL parametrizado| db[(PostgreSQL 16)]
  mig[migrate<br/>dono do banco] -->|migrações + permissões| db
  op([Operador local]) -.->|comando operator<br/>depósito / master| api
  dbeaver([DBeaver]) -.->|127.0.0.1:5433| db
  user -.->|imagens do mapa| osm[(OpenStreetMap)]
  api -.->|porta simulada| pix[[PixDirectoryProvider<br/>DICT simulado]]
  api -.->|porta simulada| mail[[MailProvider / DepositProvider<br/>simulados]]
```

Só o gateway e o PostgreSQL (para o DBeaver) publicam portas, ambos em `127.0.0.1`. A API conecta como `wallet_app`, que não altera o esquema nem o histórico; as migrações rodam em um container separado com o dono do banco. Linhas tracejadas são integrações opcionais ou simuladas.

### 2. Camadas do backend

```mermaid
flowchart TB
  req([Requisição]) --> guard[AccessGuard global<br/>origem, sessão, 2FA, perfil, limite de escrita]
  guard --> pipe[ValidationPipe global<br/>DTO com whitelist]
  pipe --> ctl[Controller<br/>só traduz HTTP]
  ctl --> svc[Service<br/>regra de negócio + transação]
  svc --> uow[Database.transaction<br/>unidade de trabalho]
  svc --> repo[Repository<br/>único lugar com SQL]
  svc -->|interfaces por token| ports[Provedores<br/>MAIL_PROVIDER · DEPOSIT_PROVIDER · PIX_DIRECTORY]
  svc --> aud[AuditService<br/>trilha somente de inclusão]
  repo --> pg[(PostgreSQL)]
  uow --> pg
  svc -. exceção .-> flt[ErrorsFilter global<br/>resposta segura + auditoria]
```

```mermaid
flowchart LR
  app[AppModule] --> auth[auth<br/>cadastro · login · 2FA · recuperação]
  app --> wallet[wallet<br/>razão · transferência · devolução · depósito]
  app --> notif[notifications]
  app --> banking[banking<br/>contas · chaves Pix]
  app --> settings[settings<br/>preferências · rosto]
  app --> access[access<br/>trilha de acesso]
  app --> admin[admin<br/>consultas do master]
  app --> infra[common<br/>database · audit · rate-limit · http · security]
  auth --> settings
  auth --> access
  wallet --> notif
```

### 3. Transferência (consistência e reversão)

```mermaid
sequenceDiagram
  participant B as Navegador
  participant G as AccessGuard
  participant T as TransfersService
  participant D as PostgreSQL (uma transação)
  B->>G: POST /transfers + Idempotency-Key
  G->>G: origem, sessão completa, perfil, limite
  G->>T: usuário da sessão (nunca do corpo)
  T->>D: BEGIN
  T->>D: bloqueio de idempotência (chave + escopo)
  alt chave já usada com os mesmos dados
    D-->>T: movimento original
    T-->>B: resultado original (sem pagar de novo)
  else nova solicitação
    T->>D: FOR UPDATE nas duas carteiras, em ordem de id
    T->>D: confere saldo, debita e credita
    T->>D: INSERT movimento + 2 lançamentos (partida dobrada)
    T->>D: INSERT notificação + idempotência + auditoria
    T->>D: COMMIT
    T-->>B: movimento + mensagem
  end
  Note over T,D: qualquer erro faz ROLLBACK de tudo<br/>e a falha é auditada depois, fora da transação
```

A devolução é um **novo** movimento ligado ao original (`UNIQUE(original_id)`); nada é apagado nem editado.

### 4. Modelo de dados

```mermaid
erDiagram
  users ||--|| wallets : possui
  users ||--o{ sessions : abre
  users ||--o{ recovery_codes : tem
  users ||--o{ password_resets : solicita
  users ||--o{ movements : "envia (sender)"
  users ||--o{ movements : "recebe (recipient)"
  users ||--o{ notifications : recebe
  users ||--o{ audit_events : "autor"
  users ||--o| user_settings : preferencias
  users ||--o| face_templates : "rosto cifrado"
  users ||--o{ bank_accounts : cadastra
  users ||--o{ access_log : acessos
  bank_accounts ||--o{ pix_keys : "até 5 PF / 20 PJ"
  wallets ||--o{ entries : lancamentos
  movements ||--|{ entries : "2 por movimento"
  movements ||--o| movements : "devolução (original_id único)"
  movements ||--o{ notifications : origina
  movements ||--o| idempotency : "chave"

  users {
    uuid id PK
    text email UK
    text password_hash "scrypt"
    text role "user | master"
    text totp_secret "AES-256-GCM"
    bigint last_totp_step "anti-replay"
  }
  wallets {
    uuid user_id PK
    bigint balance "CHECK 0..10 bi (centavos)"
  }
  movements {
    uuid id PK
    text kind "deposit | transfer | refund"
    uuid sender_id
    uuid recipient_id
    bigint amount "centavos"
    uuid original_id UK
  }
  entries {
    bigserial id PK
    uuid movement_id
    uuid user_id
    bigint delta "assinado"
    bigint balance_after
  }
  idempotency {
    text scope PK
    text key PK
    text fingerprint
  }
  audit_events {
    bigserial id PK
    text action
    text outcome
    uuid correlation_id
    jsonb location
  }
  sessions {
    text token_hash PK "SHA-256"
    text stage "setup | challenge | full"
  }
  access_log {
    uuid id PK
    text token_hash
    timestamptz started_at
    timestamptz ended_at "preenchido uma vez"
    jsonb location
  }
  pix_keys {
    uuid id PK
    text key_type
    text key_value UK "global"
    text status "pending | approved | rejected"
  }
  bank_accounts {
    uuid id PK
    char bank_code
    varchar agency
    varchar account_number
    varchar holder_document
  }
  notifications {
    uuid id PK
    text kind
    timestamptz read_at
  }
  face_templates {
    uuid user_id PK
    text template "AES-256-GCM"
  }
  user_settings {
    uuid user_id PK
    boolean biometric_enabled
    boolean geolocation_enabled
    boolean face_enabled
  }
```

`movements`, `entries` e `audit_events` são imutáveis (gatilhos + permissões); `access_log` só aceita o preenchimento único do encerramento. `rate_limits` (limite de tentativas) não tem relação com as demais e foi omitida do diagrama.

## Separação de responsabilidades

O backend é um monólito modular NestJS. Cada módulo tem controlador (HTTP), serviços (regras), repositórios (SQL) e DTOs (contrato de entrada):

```text
backend/src
├── main.ts / app.module.ts     inicialização e composição; guard, filtro e pipe globais
├── operator.ts / migrate.ts    comandos locais (depósito, master) e migrações
├── common/
│   ├── database/               Database: pool e transação (unidade de trabalho)
│   ├── audit/                  AuditService + AuditRepository (trilha somente de inclusão)
│   ├── rate-limit/             RateLimiter + repositório (janela fixa no PostgreSQL)
│   ├── http/                   AccessGuard, ErrorsFilter, decoradores de acesso, logger de requisições
│   ├── dto/                    campos reutilizáveis e ValidationPipe
│   └── security/               crypto (scrypt, AES-GCM, TOTP) e validadores
├── notifications/              NotificationsService + repositório (avisos de transferência/devolução recebidas)
├── banking/                    BankingService + repositório (contas, chaves Pix), regras de formato (pix-key.rules),
│                               porta PixDirectoryProvider (DICT simulado)
├── settings/                   SettingsService (biometria, geolocalização), FaceService (rosto cifrado, comparação)
├── access/                     AccessService + AccessLogRepository (trilha de acesso: login, logout, duração, local)
├── users/                      UsersRepository
├── auth/                       AuthService, TwoFactorService, PasswordRecoveryService,
│                               repositórios de sessão/códigos/redefinição, MailProvider
├── wallet/                     LedgerService (partida dobrada), IdempotencyService,
│                               TransfersService (transferir/devolver), DepositsService,
│                               WalletService (saldo/extrato), DepositProvider
├── admin/                      AdminService + AdminRepository (leituras do master)
└── health/                     /api/health
```

Decisões e princípios:

- **Camadas:** o controlador só traduz HTTP; o serviço aplica a regra de negócio e define a transação; o repositório é o único lugar com SQL. Isso permite testar as regras com repositórios em memória (`test/helpers/memory.mjs`), sem banco.
- **Responsabilidade única:** o razão (`LedgerService`) só lança partidas e valida saldo; idempotência, transferência, depósito e consulta são serviços distintos; `AuthService`, `TwoFactorService` e `PasswordRecoveryService` separam login, segundo fator e recuperação.
- **Inversão de dependência:** serviços dependem de interfaces ligadas por token (`MAIL_PROVIDER`, `DEPOSIT_PROVIDER`). Trocar o provedor simulado por um real é mudar uma linha no módulo, sem tocar nas regras. Um provedor real ainda exigirá contrato, confirmação autenticada e conciliação.
- **Acesso declarativo:** `@Access("public" | "any-stage" | "partial")` e `@Roles(...)` nas rotas, aplicados por um único `AccessGuard`. Sem decorador, a rota exige sessão completa com 2FA; o master é barrado nas rotas de usuário e vice-versa.
- **Entrada validada por DTO:** `class-validator` com `whitelist` e `forbidNonWhitelisted`; um campo desconhecido (como `role`) derruba a requisição em vez de ser ignorado.
- **Padrões usados:** repositório, unidade de trabalho (transação), estratégia/adaptador (provedores), idempotência por chave e impressão digital, guard e filtro de exceções do Nest.
- **Tratamento de erros em camadas:** `Database.transaction` faz `try/catch` com ROLLBACK e preserva o erro original mesmo que o rollback falhe (a conexão quebrada é descartada); `TransfersService` e `DepositsService` capturam falhas inesperadas, registram uma linha estruturada (`logUnexpected`, sem dados pessoais) e relançam, e uma queda do provedor de depósito vira 503 sem creditar nada; `ErrorsFilter` global é a última barreira: recusas de negócio mantêm a mensagem, o restante vira um 500 genérico e tudo é auditado. Não se repete `try/catch` em cada controlador: o filtro global cumpre esse papel em um único lugar.
- **Saldo inicial pelo usuário:** `DepositsService` tem duas portas de entrada sobre o mesmo caminho interno (`credit`): o comando do operador e `selfDeposit`, usado por `POST /deposits`. O usuário só credita a própria carteira (id da sessão, nunca do corpo), com teto de R$ 10.000,00 por operação, 20 adições por hora, idempotência em escopo próprio de cada usuário e auditoria com a origem (`self-service`). O dinheiro continua entrando só como movimento `deposit`, então a conciliação (soma dos saldos = soma dos depósitos) segue válida. É um recurso de demonstração, ligado por `DEMO_DEPOSITS`: com dinheiro real, quem confirma o pagamento é o provedor.
- **Notificações:** o destinatário de uma transferência e quem enviou a transferência original de uma devolução recebem um aviso. O aviso é criado NA MESMA transação do movimento (`NotificationsService.create`): se houver rollback, o aviso some junto, e uma repetição por idempotência não cria outro (`UNIQUE(user_id, movement_id)`). A tabela `notifications` é a única do domínio financeiro com UPDATE permitido à API, pois marcar como lida grava `read_at`; os movimentos continuam imutáveis. A listagem mostra só as NÃO lidas (índice parcial), então ao ler o aviso some. Cada usuário lê e altera apenas os próprios avisos (404 igual para inexistente e alheio). O frontend consulta `GET /notifications/count` a cada 15 s e ao voltar à aba, acende o sino e mostra um toast quando o número aumenta.
- **Perfil, dados bancários e Pix:** contas e chaves são cadastro do usuário (não razão financeiro), por isso a API pode alterá-las; toda consulta filtra pelo usuário da sessão e um id alheio devolve 404. O formato da chave é validado por funções puras (`pix-key.rules.ts`: dígitos verificadores de CPF/CNPJ, celular `+55`, e-mail, chave aleatória gerada no servidor). `UNIQUE(key_value)` é global: a chave existe em uma só conta, como no DICT, o que também a impede de repetir dentro de um banco; a corrida entre dois cadastros é decidida pela restrição do banco (23505 vira 409). O limite de chaves (5 PF, 20 PJ) é conferido com a conta bloqueada (`FOR UPDATE`). O "registro no Banco Central" é uma SIMULAÇÃO atrás da interface `PixDirectoryProvider` (e-mail e celular exigem código de posse, guardado só como hash, 5 tentativas, 10 minutos); trocar pelo DICT real é mudar uma linha no módulo.
- **Reconhecimento facial:** o navegador (face-api.js, arquivos servidos pelo próprio site, sem serviço externo) detecta o rosto, exige a prova de vida (direita, esquerda, abaixar, levantar, sorrir) e produz um vetor de 128 números; só ele sai do aparelho. O servidor o cifra (AES-256-GCM, mesma chave do 2FA) e compara por distância euclidiana (limite 0,5). Ativar e desativar pedem a senha. Na recuperação de senha o rosto SOMA-se ao link do e-mail e não o substitui: a prova de vida roda no navegador, que o atacante controla, então sozinha ela não sustenta a recuperação. Uma recusa desfaz a transação e o link continua valendo, mas as tentativas são limitadas (5 por 15 min) e auditadas fora da transação (um INSERT de auditoria dentro dela esperaria o bloqueio do usuário). Biometria do aparelho é apenas um sinalizador para o aplicativo móvel.
- **Trilha de acesso:** a tabela `access_log` recebe um registro por login completo, na mesma transação que cria a sessão. O gatilho só permite preencher `ended_at`/`end_reason` uma vez; nada se reescreve nem se apaga. O encerramento é gravado no próprio comando que apaga a sessão (logout, troca de senha/autenticador, limite de 5 sessões) e, para sessões que apenas venceram, na leitura, com o instante do vencimento. A duração é `ended_at - started_at` (ou até agora, se aberta). Com a geolocalização desligada, o servidor descarta a localização recebida (`status: disabled`).
- **Mapas:** Leaflet com OpenStreetMap, um mapa por acesso (marcador, círculo de precisão e tooltip com data `dd/mm/yyyy h:mm:ss`) e um mapa geral. Tudo que vem do cliente (IP, aparelho) é escapado antes de entrar no tooltip. A geolocalização é pedida com alta precisão (GPS/Wi-Fi) e sem cache.
- **Mensagens de retorno:** as rotas que movem dinheiro devolvem o movimento mais um `message` em português, definido no servidor; erros também trazem `message` e `correlationId`.
- **Comentários:** classes e métodos com regra não óbvia têm comentário JSDoc explicando o porquê (bloqueios, idempotência, segurança), não o que o código já diz.
- **Mensagens ao usuário:** o frontend centraliza avisos em `frontend/app/alerts.ts` (SweetAlert2): confirmação antes de transferir e de devolver, notificação de sucesso e modal de erro com a mensagem segura devolvida pela API.
- SQL parametrizado torna os bloqueios e limites transacionais explícitos; um backend único reduz a complexidade operacional do desafio.

## Consistência financeira

Centavos inteiros, restrições no banco, carteira sem saldo negativo e limite de R$ 10 bilhões por carteira/operação. Os limites são de demonstração, não de política bancária real.

Transferência bloqueia as carteiras em ordem de UUID, debita, credita, insere movimentação, lançamentos, chave de idempotência e auditoria na mesma transação. Qualquer falha desfaz tudo. Falhas e recusas são auditadas separadamente após o rollback.

Requisições repetidas são serializadas por chave de idempotência e escopo. Devoluções são também serializadas pelo ID da transferência original, sem exigir permissão de alteração do histórico. Uma restrição única impede duas devoluções da mesma transferência. Não se apagam nem se editam registros financeiros para representar estorno.

## Autenticação e autorização

- Senhas derivadas com scrypt e salt individual.
- TOTP de 6 dígitos, período de 30 segundos, tolerância de um período e bloqueio de reutilização do contador aceito.
- Segredo TOTP cifrado com AES-256-GCM; chave externa ao código.
- Oito códigos de recuperação de uso único, guardados como hashes e exibidos somente na ativação.
- Sessões opacas aleatórias; apenas hashes ficam no banco. Etapa parcial expira em 10 minutos; completa em 8 horas.
- No máximo 5 sessões completas simultâneas por usuário; ao entrar uma nova, as mais antigas são revogadas. Não há tela para listar ou encerrar sessões individualmente.
- Cookies HttpOnly e SameSite=Strict; POST exige origem permitida e cabeçalho específico.
- Limites persistidos no PostgreSQL: login por conta/IP, segundo fator, cadastro e operações autenticadas.
- Cadastro não recebe perfil; master nasce exclusivamente no provisionamento local e também exige 2FA.
- Recuperação de senha: token aleatório de 256 bits, válido por 7 minutos, de uso único (`DELETE ... RETURNING`); só o hash fica no banco e um novo pedido invalida o anterior. A resposta ao pedido é igual para contas existentes ou não, com limite por IP e por e-mail. O token viaja no fragmento da URL (não vai ao servidor nem a logs de acesso) e é removido da barra de endereço ao ser lido. Redefinir a senha encerra todas as sessões e não desativa o 2FA. O envio é simulado (`DEMO_MAIL=true` escreve o link no log da API); um provedor real implementaria `MailProvider`.
- Troca do autenticador exige senha e segundo fator/recuperação, revoga todas as sessões e bloqueia operações até a nova ativação.

## Auditoria e localização

Eventos contêm autor quando identificado, recurso, data do servidor, resultado, motivo, correlação, IP, navegador e localização quando disponível. Tentativas de login com conta conhecida são associadas ao recurso da conta, mesmo sem autor autenticado. Consultas do master também são registradas. Como a trilha é somente de inclusão, o ruído anônimo (rotas inexistentes, e-mails desconhecidos) tem orçamento de 100 eventos por IP a cada 15 minutos; o excedente vira uma linha `audit.suppressed` no log, sem dados pessoais. Eventos de conta conhecida ou de usuário autenticado nunca são descartados. A consulta de saldo não gera evento; o extrato, sim.

A credencial do serviço não tem UPDATE/DELETE em auditoria, movimentações ou lançamentos. Gatilhos também recusam mutações do histórico. Isso protege contra alterações pela aplicação, mas não constitui armazenamento inviolável contra um administrador do banco com poder de alterar o esquema.

Senha, token, códigos TOTP, chaves de recuperação e segredo do autenticador não entram nos logs. Localização é contextual, validada quanto ao formato e não verificada quanto à veracidade. Na área do master a visualização usa grade geográfica local. Na página de perfil do usuário os mapas usam o OpenStreetMap: nossas rotas não enviam coordenadas a ele, mas o navegador pede as imagens da região ao serviço, que pode inferir a área consultada.

Política desta demonstração: usar dados fictícios; manter dados somente durante o período de avaliação, com prazo operacional máximo proposto de 30 dias. A remoção ao encerrar a demonstração exige procedimento explícito do responsável sobre o volume, pois a aplicação não permite apagar a trilha. Não há expurgo automático implementado. Produção exige política própria de retenção, controles de acesso, backup, gestão de chaves e operação.

## Limitações deliberadas

- Não movimenta dinheiro real, não integra bancos e não oferece saques.
- HTTP e cookie sem Secure somente no localhost; publicação externa exige HTTPS, cookie Secure e origens/rede configuradas. A geolocalização em celular exige contexto seguro e acesso de rede próprio, não disponível nesta configuração local.
- Monitoramento é um painel consultado sob demanda, com healthchecks e logs. Alertas visuais surgem a partir de 5 recusas/falhas em 15 minutos ou divergência de conciliação; não há envio de notificações.
- A grade do master mostra latitude/longitude e precisão, sem mapa de ruas; os mapas do perfil dependem do OpenStreetMap (internet) e continuam sem identificar fisicamente o dispositivo.
- O registro de chaves Pix é simulado (sem DICT nem credenciamento no Banco Central) e o catálogo de bancos é fixo. O reconhecimento facial tem a prova de vida no navegador e só é aceito junto com o link do e-mail; produção pediria o SDK biométrico do aplicativo ou um serviço certificado.
- A senha pode ser redefinida por link de 7 minutos, mas o e-mail é simulado (o link aparece no log da API com `DEMO_MAIL=true`; não deve ficar ativo fora da demonstração). A perda do autenticador depende de um código de reserva; não há desativação de 2FA nem recuperação por SMS.
- As credenciais iniciais ficam nos arquivos locais ignorados pelo Git; o responsável deve protegê-los e controlar o acesso ao Docker.

## Evolução para dinheiro real

Integrar com banco/provedor habilitado, definir modelo de contas e recursos, confirmar pagamentos por notificações autenticadas, conciliar saldos externos e internos e tratar operações pendentes. A transação local não reverte automaticamente uma operação externa já liquidada. Essa evolução não está implementada.
