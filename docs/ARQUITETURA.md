# Arquitetura e decisões

```text
Navegador → localhost:3080 / Nginx
                         ├── /       → Next.js (frontend)
                         └── /api/*  → NestJS → PostgreSQL
Operador local → comando controlado de depósito / provisionamento master
```

Gateway e PostgreSQL publicam portas limitadas a 127.0.0.1: 3080 para a aplicação e 5433 para acesso local pelo DBeaver. API e frontend usam apenas rede Docker privada. O gateway sobrescreve o cabeçalho de IP encaminhado, e a API confia em um único proxy. Em Docker Desktop, NAT pode fazer o IP observado corresponder ao intermediário local; ele não deve ser apresentado como identificação inequívoca de um telefone.

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

Senha, token, códigos TOTP, chaves de recuperação e segredo do autenticador não entram nos logs. Localização é contextual, validada quanto ao formato e não verificada quanto à veracidade. A visualização usa grade geográfica local, sem enviar coordenadas a serviços externos.

Política desta demonstração: usar dados fictícios; manter dados somente durante o período de avaliação, com prazo operacional máximo proposto de 30 dias. A remoção ao encerrar a demonstração exige procedimento explícito do responsável sobre o volume, pois a aplicação não permite apagar a trilha. Não há expurgo automático implementado. Produção exige política própria de retenção, controles de acesso, backup, gestão de chaves e operação.

## Limitações deliberadas

- Não movimenta dinheiro real, não integra bancos e não oferece saques.
- HTTP e cookie sem Secure somente no localhost; publicação externa exige HTTPS, cookie Secure e origens/rede configuradas. A geolocalização em celular exige contexto seguro e acesso de rede próprio, não disponível nesta configuração local.
- Monitoramento é um painel consultado sob demanda, com healthchecks e logs. Alertas visuais surgem a partir de 5 recusas/falhas em 15 minutos ou divergência de conciliação; não há envio de notificações.
- A grade local mostra latitude/longitude e precisão, sem mapa de ruas, geocodificação ou identificação física do dispositivo.
- A senha pode ser redefinida por link de 7 minutos, mas o e-mail é simulado (o link aparece no log da API com `DEMO_MAIL=true`; não deve ficar ativo fora da demonstração). A perda do autenticador depende de um código de reserva; não há desativação de 2FA nem recuperação por SMS.
- As credenciais iniciais ficam nos arquivos locais ignorados pelo Git; o responsável deve protegê-los e controlar o acesso ao Docker.

## Evolução para dinheiro real

Integrar com banco/provedor habilitado, definir modelo de contas e recursos, confirmar pagamentos por notificações autenticadas, conciliar saldos externos e internos e tratar operações pendentes. A transação local não reverte automaticamente uma operação externa já liquidada. Essa evolução não está implementada.
