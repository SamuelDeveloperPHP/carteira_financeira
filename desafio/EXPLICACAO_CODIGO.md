# Explicação do código

Guia para explicar o código da carteira financeira a quem avalia o desafio. Reúne quatro partes: a explicação geral do código, a aplicação de SOLID, o reconhecimento facial e como exportar o conteúdo do Docker. Os caminhos citados são relativos à raiz do repositório.

Para o roteiro de demonstração ao vivo, veja [DEMONSTRACAO.md](DEMONSTRACAO.md); para a conversa sobre decisões, [APRESENTACAO.md](../docs/APRESENTACAO.md); para os diagramas, [ARQUITETURA.md](../docs/ARQUITETURA.md).

---

## Parte 1. Explicação do código

### 1. Visão geral

- Quatro containers atrás de um **Nginx** (gateway): `/api` vai para a API NestJS e o resto vai para o frontend Next.js. O banco é PostgreSQL ([compose.yaml](../compose.yaml)).
- No backend, cada funcionalidade é um módulo com a mesma divisão: **controller** (recebe HTTP), **service** (regra e transação) e **repository** (único lugar com SQL).
- O [app.module.ts](../backend/src/app.module.ts) só compõe os módulos e registra três peças globais: um **guard** (quem entra), um **filtro** (todo erro termina nele) e um **pipe** (valida a entrada).

### 2. O caminho de uma requisição

1. [request-logger.ts](../backend/src/common/http/request-logger.ts) gera o `correlationId` e marca a resposta como `no-store`.
2. O **guard** global, [access.guard.ts](../backend/src/common/http/access.guard.ts), é "seguro por padrão": toda rota nova já exige sessão completa com 2FA.
   - Ele confere a origem (CSRF), a sessão no banco e o perfil (`user` ou `master`).
   - Rotas públicas ou parciais precisam declarar isso com `@Access`.
3. O **pipe** valida o corpo pelos DTOs, e campos extras são recusados (enviar `role: "master"` no cadastro falha).
4. Controller → service → repository.
5. Qualquer erro cai no [errors.filter.ts](../backend/src/common/http/errors.filter.ts): recusa de negócio mantém a mensagem, bug vira um 500 genérico, e tudo é auditado com o `correlationId`.

### 3. Autenticação: [auth.service.ts](../backend/src/auth/auth.service.ts)

- **Cadastro:** senha com **scrypt** e salt individual ([crypto.ts](../backend/src/common/security/crypto.ts)). Usuário e carteira nascem na mesma transação, e e-mail duplicado é barrado pelo `UNIQUE` do banco. A resposta é a mesma para e-mail novo e existente.
- **Login em duas etapas:**
  - `login` confere a senha e abre uma sessão **parcial** (`setup` ou `challenge`).
  - `verify` confere o TOTP ou um código de recuperação e troca a sessão por uma **completa**, com token novo (evita fixação de sessão).
- **Sessões** ([sessions.repository.ts](../backend/src/auth/sessions.repository.ts)): o cookie leva um token de 256 bits, e o banco guarda só o **SHA-256** dele. Isso permite revogar na hora, e há no máximo 5 sessões completas por usuário.
- **Limite de tentativas:** só as falhas contam, o contador é por e-mail + IP e acertar o login o zera ([rate-limiter.service.ts](../backend/src/common/rate-limit/rate-limiter.service.ts)).
- **2FA** ([two-factor.service.ts](../backend/src/auth/two-factor.service.ts)): o segredo é guardado **cifrado** (AES-256-GCM). O código não pode ser reutilizado, porque guardamos o último intervalo de 30 s aceito.

### 4. O coração do desafio: dinheiro

**[ledger.service.ts](../backend/src/wallet/ledger.service.ts) (`post`)** é o único caminho que mexe em saldo. Depósito, transferência e devolução passam por ele:

1. Bloqueia as carteiras com `FOR UPDATE`, **em ordem fixa de id** (evita deadlock entre A→B e B→A).
2. Só depois lê o saldo e valida. Duas saídas simultâneas não gastam o mesmo dinheiro, e o banco ainda tem `CHECK (balance >= 0)`.
3. Grava o movimento e **um lançamento por carteira**, com o valor negativo para quem paga e positivo para quem recebe (partida dobrada).

**[transfers.service.ts](../backend/src/wallet/transfers.service.ts)** cobre os dois níveis de reversão:

- **Automática:** `Database.transaction` ([database.service.ts](../backend/src/common/database/database.service.ts)) dá COMMIT ou ROLLBACK de tudo. Movimento, saldo, lançamentos, notificação, idempotência e auditoria vão na **mesma** transação.
- **Por pedido do usuário (`refund`):**
  - só quem recebeu pode devolver;
  - a devolução é **integral e única** (`UNIQUE original_id` no banco);
  - ela é um **novo movimento** ligado ao original, e nada é apagado.

**[idempotency.service.ts](../backend/src/wallet/idempotency.service.ts):** o cliente envia uma `Idempotency-Key`. Repetir com os mesmos dados devolve o resultado original, e repetir com dados diferentes dá 409.

### 5. Banco de dados: [001_initial.sql](../backend/migrations/001_initial.sql)

- Dinheiro em **centavos** (`bigint`), nunca decimal.
- `movements` e `entries` são o razão, e `audit_events` é a trilha. Os três são **somente inclusão**, por gatilhos mais permissão: a API conecta como `wallet_app`, sem UPDATE ou DELETE nessas tabelas.
- [migrate.ts](../backend/src/migrate.ts) roda em um container separado, como dono do banco, em uma transação com trava consultiva.

### 6. Módulos de perfil

- **Banking/Pix** ([banking.service.ts](../backend/src/banking/banking.service.ts)): as regras de formato são funções puras em `pix-key.rules.ts`. O diretório do Banco Central fica atrás de uma interface (`PixDirectoryProvider`) e hoje é simulado. A chave é única no sistema, e o código de posse é guardado só como hash.
- **Rosto** ([face.service.ts](../backend/src/settings/face.service.ts)): o navegador gera um vetor de 128 números, e o servidor o cifra e compara por distância. Ele soma ao link do e-mail na recuperação de senha e não o substitui.
- **Acessos** ([access-log.repository.ts](../backend/src/access/access-log.repository.ts)): a linha é aberta no login e fechada no logout, e as consultas não escrevem no banco.
- **Insights** ([insights.rules.ts](../backend/src/insights/insights.rules.ts)): as agregações são SQL, e as sugestões vêm de uma função **pura**, fácil de testar.
- **Admin:** só leitura, e toda consulta do master também é auditada.

### 7. Frontend ([frontend/app](../frontend/app))

- Uma pasta por tela, em `(app)/` (relatorios, carteira, perfil, contas, eventos e outras).
- [session.tsx](../frontend/app/session.tsx) guarda o usuário no estado, consultando `/auth/status`. O cookie é HttpOnly, então o JavaScript nunca vê o token.
- [api.ts](../frontend/app/api.ts) é a única saída para a API. Ele envia o cabeçalho anti-CSRF `X-Wallet-Request` e o `code` de erro que o `session.tsx` usa para detectar sessão expirada.
- Os redirecionamentos do layout são só conforto, e quem protege de verdade é o servidor.
- Na tela da carteira, a chave de idempotência fica em `useRef`, para que um segundo clique reaproveite a mesma chave.

### 8. Como provar que funciona

- 105 testes ([backend/test](../backend/test)): unitários com repositórios em memória e integração contra PostgreSQL real, incluindo 25 saídas simultâneas.
- E2E com Playwright em [e2e/tests/cliente.spec.ts](../e2e/tests/cliente.spec.ts).
- CI em [ci.yml](../.github/workflows/ci.yml).

### Sugestão de ordem para explicar

1. A arquitetura em uma frase (controller → service → repository).
2. A requisição passando pelo guard.
3. Uma transferência de ponta a ponta, em `transfers.service.ts` e `ledger.service.ts`.
4. O SQL que impõe as regras.
5. Os testes que as provam.

---

## Parte 2. SOLID no projeto

A arquitetura aplica os cinco princípios com evidência concreta, mas há pontos fracos que vale assumir antes de o avaliador perguntar.

### S: Responsabilidade única

**Bem aplicado**

- Cada camada tem um papel: o controller só fala HTTP, o service decide a regra e a transação, e o repository tem todo o SQL.
- O dinheiro é dividido por responsabilidade:
  - [ledger.service.ts](../backend/src/wallet/ledger.service.ts) só registra o lançamento (travar, validar saldo, gravar).
  - [idempotency.service.ts](../backend/src/wallet/idempotency.service.ts) só cuida de repetição.
  - [transfers.service.ts](../backend/src/wallet/transfers.service.ts) orquestra o caso de uso.
  - [deposits.service.ts](../backend/src/wallet/deposits.service.ts) cuida do depósito.
- Na autenticação há separação parecida: `auth.service` (login e sessão), `two-factor.service` (2FA) e `password-recovery.service` (recuperação).
- As regras puras ficam em funções sem dependências, como `pix-key.rules.ts`, `insights.rules.ts` e `face-matching.ts`, o que as torna trivialmente testáveis.

**Ponto fraco:** `banking.service.ts` tem 515 linhas e mistura contas, chaves, prova de posse e entrega do código. Dividir em `AccountsService` e `PixKeysService` seria o próximo passo. O `AuthService` (345 linhas, 8 dependências) acumula cadastro, login, sessão, verificação e logout.

### O: Aberto para extensão, fechado para modificação

**Bem aplicado**

- Trocar o provedor de e-mail, de depósito ou o diretório Pix é escrever **uma classe nova** e mudar **uma linha** no módulo, sem tocar nos serviços:
  - `{ provide: MAIL_PROVIDER, useClass: SimulatedMail }`
  - `{ provide: DEPOSIT_PROVIDER, useClass: SimulatedDepositProvider }`
  - `{ provide: PIX_DIRECTORY, useClass: SimulatedPixDirectory }`
- Nova regra de sugestão de BI é uma entrada nova em `buildSuggestions`. Novo tipo de aviso é uma entrada no mapa `MESSAGES` de [notifications.service.ts](../backend/src/notifications/notifications.service.ts).
- As proteções globais (guard, filtro e pipe) valem para rotas futuras sem alterar nada.

**Ponto fraco:** adicionar um novo tipo de chave Pix exige editar o `switch` de `pix-key.rules.ts`. Isso poderia ser uma tabela de estratégias por tipo.

### L: Substituição de Liskov

**Bem aplicado**

- Qualquer implementação de `MailProvider`, `DepositProvider` ou `PixDirectoryProvider` pode entrar no lugar da simulada. Os testes fazem isso o tempo todo com fakes, incluindo um provedor que lança erro para provar o comportamento em falha.
- `Queryable` é satisfeito tanto pelo pool quanto pela transação (`PoolClient`). Por isso os repositórios funcionam com ou sem transação, sem saber qual receberam.
- As exceções próprias (`FaceMismatchException`, `TotpReplayException`) estendem as do Nest (`Forbidden`, `Unauthorized`). O filtro global as trata como qualquer outra, sem ramo especial.

**Ressalva:** o contrato dos provedores depende de convenção (lançar `HttpException` para recusa deliberada, outro erro para falha). Está documentado nos comentários, mas não no tipo.

### I: Segregação de interfaces

**Bem aplicado**

- As interfaces são pequenas e focadas no que o cliente usa:
  - `MailProvider` tem um método (`sendPasswordReset`);
  - `DepositProvider` tem `confirm`;
  - `PixDirectoryProvider` tem três (`submit`, `sendOwnershipCode`, `confirm`);
  - `Queryable` tem só `query`.
- Nenhum serviço é obrigado a depender de métodos que não usa.

**Ponto fraco:** os repositórios são classes concretas, sem interface. Isso é deliberado (o ganho seria pequeno), mas é uma escolha a defender.

### D: Inversão de dependência

**Bem aplicado**

- Os serviços recebem tudo pelo construtor (injeção do Nest) e dependem de **abstrações** nas fronteiras externas, com tokens `Symbol` para e-mail, depósito e Pix.
- Os testes unitários montam o serviço com repositórios em memória, sem banco, e `Database.transaction` é a única "Unidade de Trabalho".
- A regra de negócio (ledger) não sabe nada de HTTP, e o controller nada de SQL.

**Pontos fracos, honestamente**

- Os serviços dependem da classe concreta `Database` e recebem o `tx: Queryable` por parâmetro. Isso vaza um detalhe de persistência para a camada de aplicação. Em uma arquitetura hexagonal estrita haveria uma porta de "unidade de trabalho" no domínio.
- Há `process.env` lido diretamente em alguns pontos (guard, cookies, provedores simulados, `database.service`) em vez de um serviço de configuração injetado.

### Padrões de projeto usados

| Padrão | Onde |
|---|---|
| Repository | `*.repository.ts` |
| Unit of Work | `Database.transaction` |
| Ports & Adapters / Strategy | `MAIL_PROVIDER`, `DEPOSIT_PROVIDER`, `PIX_DIRECTORY` |
| Cadeia de responsabilidade | guard → pipe → controller → filtro |
| DTO | validação e whitelist de entrada |
| Funções puras | regras de Pix, de BI e de comparação facial |

### Como apresentar em uma frase

> "Apliquei SOLID onde ele compra segurança e testabilidade: o dinheiro passa por um único serviço contábil, as integrações externas ficam atrás de interfaces trocáveis, e as regras são funções puras. Onde seria cerimônia sem ganho, como interfaces para repositórios, preferi simplicidade."

---

## Parte 3. Reconhecimento facial

### Biblioteca

- **`@vladmandic/face-api`** (versão ^1.7.15), uma versão mantida do face-api.js, que roda sobre TensorFlow.js **no navegador**.
- Não há serviço externo: o script e os modelos ficam no próprio site. O script [vendor.mjs](../frontend/scripts/vendor.mjs) copia a biblioteca e os modelos do `node_modules` para `public/vendor` antes do build. Esses arquivos não são versionados, e a versão fica travada no `package-lock.json`.
- São usados **4 modelos**:

| Modelo | Para quê |
|---|---|
| `tiny_face_detector` | achar o rosto na imagem (leve) |
| `face_landmark_68` | 68 pontos do rosto, base da prova de vida |
| `face_recognition` | gerar o **vetor de 128 números**, a "impressão" do rosto |
| `face_expression` | detectar o sorriso |

### Como funciona, em 4 passos

**1. Captura e prova de vida** ([FaceCapture.tsx](../frontend/app/profile/FaceCapture.tsx))

- Lê um quadro a cada 180 ms.
- Olhar de frente colhe 3 vetores faciais, e a média deles é o vetor final, o que reduz ruído de um quadro só.
- Depois vêm as 5 etapas na ordem: direita, esquerda, abaixar, levantar e sorrir.
- Cada etapa precisa ser mantida por 3 quadros seguidos, com limite de 25 s.
- Exige exatamente **um** rosto na imagem.
- Ao fechar, a câmera é desligada.

**2. Geometria da pose** ([pose.ts](../frontend/app/profile/pose.ts)), funções puras sobre os 68 pontos:

- **Virar o rosto** (`yaw`): a posição do nariz entre os extremos do maxilar. Vale cerca de 0,5 de frente e muda mais de 0,1 ao virar.
- **Abaixar ou levantar** (`pitch`): a razão entre a distância nariz–olhos e queixo–olhos.
- **Sorrir:** pontuação da expressão "feliz" de pelo menos 0,7.
- As comparações são relativas à pose medida de frente no início, então funcionam para rostos e posições diferentes.

**3. O que sai do navegador:** só o vetor de 128 números e a lista das 5 etapas. O vídeo e as fotos nunca são enviados.

**4. Servidor** ([face.service.ts](../backend/src/settings/face.service.ts))

- Valida o vetor (128 números finitos).
- **Cifra** com AES-256-GCM e guarda cifrado.
- Na recuperação, decifra e compara por **distância euclidiana**, aceitando até **0,5**.
- O vetor nunca é devolvido por nenhuma rota.
- Ativar e desativar exigem a **senha**.
- São 5 tentativas por 15 minutos, e as recusas são auditadas.

### Onde é usado

**Recuperação de senha:** o link do e-mail abre `reset-password`, e o rosto **soma-se** ao link, não o substitui.

- A tela consulta `/auth/reset-requirements`, que diz se o usuário tem rosto ativo, sem gastar o link.
- Se tiver, o botão "Redefinir" só habilita depois da captura.
- Rosto que não confere devolve 403, e o link continua valendo até acabar a validade ou as tentativas.

### Usabilidade

- **Tela de preparação:** título, moldura oval com silhueta e botão "Começar", nas cores do sistema. A câmera só é pedida depois do clique.
- **Modal acessível:** Esc fecha, o foco vai para a modal, a rolagem da página trava, e a lista de etapas marca ✓ conforme avançam.
- **Dicas em tempo real**, em região `aria-live` para leitores de tela. Exemplos: "Olhe de frente", "Apenas uma pessoa deve aparecer", "Não encontramos seu rosto, melhore a luz".
- **Falhas tratadas:** câmera negada, sem HTTPS ou localhost, tempo esgotado (com botão "Tentar novamente") e falha ao carregar os modelos.

### Limites que vale assumir

- A prova de vida roda **no navegador**, que quem usa controla. Ela dificulta foto e vídeo, mas não é à prova de fraude. Por isso o rosto soma ao e-mail e não o substitui.
- A comparação com limite de 0,5 é a referência do modelo, sem ajuste para taxa de falsa aceitação ou rejeição.
- Em produção o certo seria o SDK biométrico do aplicativo (Face ID ou BiometricPrompt) ou um serviço de prova de vida certificado.
- **Nunca foi testado com câmera real.** No painel do app a câmera é bloqueada. Foram verificados o carregamento da biblioteca sob o CSP e as funções puras, mas não a inferência de ponta a ponta. Teste antes de apresentar.

---

## Parte 4. Exportar o conteúdo do Docker

Entregue o **repositório**, não as imagens. O Docker aqui é "infraestrutura como código": o `compose.yaml` e os `Dockerfile`s já descrevem tudo, e quem recebe o código sobe o sistema inteiro com um comando. Só exporte imagens ou dados se o avaliador pedir isso explicitamente.

### 1. O que entregar (recomendado)

O avaliador clona o repositório e roda:

```powershell
.\scripts\setup.ps1
```

O script gera os segredos locais (`.docker.env` e `.local/master.json`), constrói as imagens, sobe os containers e cria o master. Depois é só abrir http://localhost:3080.

Sem acesso ao GitHub, gere um zip **somente do que está versionado**, sem segredos nem `node_modules`:

```powershell
git archive --format=zip --output=carteira_financeira.zip main
```

### 2. Imagens prontas (sem build)

```powershell
docker save -o carteira_imagens.tar carteira_financeira-api:local carteira_financeira-web:local postgres:16-alpine nginx:1.27-alpine
```

Quem recebe carrega com:

```powershell
docker load -i carteira_imagens.tar
```

- O arquivo fica com cerca de 1,1 GB sem compressão.
- O `.docker.env` ainda precisa existir. Se rodar `up` sem `--build`, o Compose usa as imagens carregadas.

### 3. Conteúdo do banco

```powershell
docker compose --env-file .docker.env exec -T db pg_dump -U postgres -d carteira > carteira_dump.sql
```

Para restaurar em outro ambiente:

```powershell
docker compose --env-file .docker.env exec -T db psql -U postgres -d carteira < carteira_dump.sql
```

O dump contém dados de usuários de teste: hashes de senha, segredos de 2FA **cifrados** e a trilha de auditoria. Os segredos de 2FA só são legíveis com a `TOTP_ENCRYPTION_KEY`, que **não deve ser enviada**. Restaurar um dump costuma ser desnecessário, porque as migrações recriam o esquema vazio.

### 4. O que nunca enviar

- `.docker.env` (senhas do banco e a chave de cifra do 2FA).
- `.local/master.json` (credenciais do master).
- Os volumes do Docker (`wallet-data`): têm os dados reais do banco.

Esses três já estão no `.gitignore`.

### 5. Conferir antes de entregar

Teste em uma pasta limpa para provar que o repositório se basta:

```powershell
git clone <URL-do-repositorio> teste_limpo
cd teste_limpo
.\scripts\setup.ps1
```
