# Roteiro de apresentação

Guia para explicar o projeto a quem avalia o desafio. Serve para uma conversa de 10 a 15 minutos e para responder perguntas. Os caminhos citados são clicáveis no repositório.

## 1. Abertura (1 minuto)

> "É uma carteira digital com cadastro, autenticação em dois fatores, transferência entre usuários, validação de saldo e transferência reversível. Backend em NestJS com TypeScript, frontend em Next.js, PostgreSQL e tudo em Docker. Os valores são simulados; o foco foi segurança e consistência das transações."

Arquitetura em uma frase: **controller recebe HTTP, service aplica a regra e define a transação, repository é o único lugar com SQL.** Diagrama e árvore de pastas em [ARQUITETURA.md](ARQUITETURA.md).

## 2. Os requisitos do desafio, um a um

### Cadastro
- Arquivo: `backend/src/auth/auth.service.ts` (`register`).
- Senha com **scrypt** e salt individual; nunca é guardada em claro.
- Usuário e carteira (saldo zero) nascem na **mesma transação**.
- E-mail duplicado é barrado pela restrição `UNIQUE` do banco, não por "consultar antes de inserir" (que tem corrida). A resposta é genérica para não revelar quem já é cliente.
- O DTO recusa qualquer campo extra: enviar `role: "master"` no cadastro falha.

### Autenticação
- Arquivos: `auth.service.ts`, `two-factor.service.ts`, `common/http/access.guard.ts`.
- Login em **duas etapas**: a senha só abre uma sessão *parcial*; o código do autenticador (TOTP) a promove a *completa*. Rotas com dinheiro exigem sessão completa.
- Cookie `HttpOnly` + `SameSite=Strict`; no banco fica só o **hash** do token.
- O token é trocado ao concluir o 2FA (evita fixação de sessão).
- Código TOTP não pode ser reutilizado (guarda-se o último intervalo aceito).
- 8 códigos de recuperação de uso único (só hashes).
- Recuperação de senha por link de **7 minutos**, uso único.
- Limite de tentativas no banco (por IP e por conta).

### Enviar e receber dinheiro
- Arquivos: `wallet/transfers.service.ts` e `wallet/ledger.service.ts`.
- **Razão de partida dobrada**: cada movimento gera um lançamento por carteira (negativo em quem paga, positivo em quem recebe). A soma dos saldos tem de ser igual à soma dos depósitos, e o painel do master confere isso (conciliação).
- Dinheiro em **centavos inteiros**: evita erro de ponto flutuante.

### Validar saldo antes de transferir
- Arquivo: `ledger.service.ts` (`post`).
- As carteiras são bloqueadas (`FOR UPDATE`) **antes** de ler o saldo. Duas saídas simultâneas não gastam o mesmo dinheiro: a segunda espera e vê o saldo já reduzido. Há um teste com 25 saídas concorrentes sobre o mesmo saldo.
- Bloqueio em ordem fixa de id: A→B e B→A ao mesmo tempo não geram deadlock.
- Última barreira: `CHECK (balance >= 0)` no banco.

### Transferência reversível (inconsistência ou pedido do usuário)
Existem **dois níveis**, e vale deixar isso explícito:

1. **Por inconsistência (automático)** — `database.service.ts` (`transaction`): tudo é uma transação. Qualquer falha dá ROLLBACK de saldos, movimento, lançamentos, idempotência e auditoria. Nunca fica "debitou e não creditou".
2. **Por solicitação do usuário (devolução)** — `transfers.service.ts` (`refund`): só quem recebeu pode devolver, de forma integral e **uma única vez** (`UNIQUE original_id` no banco). A devolução é um **novo movimento** ligado ao original. Nada é apagado nem editado, então a história continua auditável.

Além disso, **idempotência**: repetir a mesma requisição (clique duplo, falha de rede) devolve o resultado original em vez de pagar duas vezes.

## 3. Como responder aos critérios de avaliação

| Critério | O que destacar |
|---|---|
| **Segurança** | Guard global "seguro por padrão"; 2FA obrigatório; hashes em vez de segredos; CSRF (Origin + cabeçalho próprio + SameSite); DTO com whitelist; limite de tentativas; usuário do banco sem UPDATE/DELETE no histórico + gatilhos; SQL sempre parametrizado; erros sem detalhes internos. |
| **Argumentar escolhas** | Ver a seção 5 (perguntas e respostas). |
| **Padrões e SOLID** | Repository; Unit of Work (`Database.transaction`); inversão de dependência (`MAIL_PROVIDER`, `DEPOSIT_PROVIDER`: trocar o provedor é mudar uma linha no módulo); responsabilidade única (razão, idempotência, transferência, depósito e 2FA são serviços separados); guard e filtro globais do Nest. |
| **Modelagem de dados** | Abra `backend/migrations/001_initial.sql`: cada tabela e restrição está comentada. Destaque `movements` + `entries` (razão), `idempotency`, `audit_events` e os gatilhos de histórico imutável. |
| **Docker** | `compose.yaml`: gateway Nginx, API, frontend, PostgreSQL; perfil `test` com banco isolado em memória. |
| **Testes** | 60 testes: unitários de regra (repositórios em memória, sem banco) e integração contra PostgreSQL real (concorrência, rollback, autorização). |
| **Documentação** | README, `docs/API.md`, `ARQUITETURA.md`, `ENTREGA.md` e este roteiro; código comentado. |
| **Monitoramento e logging** | Log estruturado com ID de correlação (`X-Request-Id`) ligado à auditoria; painel de métricas, conciliação e alertas; `/api/health`. |

## 4. Demonstração ao vivo (3 a 5 minutos)

Siga o roteiro de [ENTREGA.md](ENTREGA.md). Sequência sugerida:

1. Cadastre dois usuários e configure o autenticador (QR code).
2. Credite saldo pelo comando do operador.
3. Faça uma transferência e mostre o diálogo de confirmação.
4. No segundo usuário, **devolva** a transferência e mostre o vínculo com a original.
5. Tente transferir **sem saldo** e mostre a recusa sem alteração de saldos.
6. Entre como master, filtre eventos e rastreie a movimentação: a própria consulta fica registrada.

## 5. Perguntas que o avaliador pode fazer

**Por que centavos inteiros e não `decimal`/`float`?**
`float` não representa 0,1 exatamente (0,1 + 0,2 ≠ 0,3). Inteiros em centavos são exatos e simples de somar e comparar. A conversão para reais só ocorre na tela.

**Por que um razão de partida dobrada em vez de só atualizar o saldo?**
O saldo sozinho não explica como chegou ao valor. Com lançamentos, cada centavo tem origem e destino, o extrato sai do próprio razão e é possível **conciliar** (saldo guardado = soma dos lançamentos; saldos totais = depósitos totais).

**Como garante que dois saques simultâneos não gastam o mesmo saldo?**
Bloqueio de linha (`FOR UPDATE`) na carteira antes de ler o saldo, dentro da transação. A segunda operação espera a primeira terminar e já vê o saldo reduzido. Está coberto por teste de concorrência.

**O que acontece se o servidor cair no meio de uma transferência?**
A transação não foi confirmada, então o banco descarta tudo. Se o cliente repetir o pedido com a mesma chave, a idempotência garante que não haverá pagamento duplicado.

**Por que não apagar/editar uma transferência para estornar?**
Histórico financeiro e auditoria precisam ser imutáveis. O estorno é um novo movimento que aponta para o original. Gatilhos e permissões do banco impedem UPDATE/DELETE nessas tabelas.

**Por que guardar só o hash do token de sessão?**
Se o banco vazar, os hashes não funcionam como cookie. O token tem 256 bits aleatórios, então SHA-256 é suficiente; para senhas (baixa entropia) usa-se scrypt.

**Por que 2FA obrigatório?**
Uma senha vazada, sozinha, não dá acesso ao dinheiro. O guard global exige sessão completa em qualquer rota sem decorador.

**Por que não há endpoint de depósito?**
Quem criasse saldo pela API seria um risco enorme. O depósito só existe pelo comando local do operador, atrás de uma interface de provedor, e fica desligado fora da demonstração.

**Como evitaria enumeração de usuários?**
Mensagens iguais para "e-mail não existe" e "senha errada", mesmo tempo de resposta (hash falso), resposta idêntica na recuperação de senha e cadastro com mensagem genérica.

**Por que um monólito e não microsserviços?**
Para o escopo, o monólito modular reduz complexidade operacional e mantém a consistência em uma transação local. Os módulos já têm fronteiras claras, então separar depois é viável.

**Como trocaria o provedor de e-mail/pagamento?**
Implementar a interface (`MailProvider` ou `DepositProvider`) e trocar o *binding* no módulo. Nenhuma regra de negócio muda.

**Onde estão os `try/catch`?**
Onde agregam valor: `Database.transaction` (rollback preservando o erro original), `TransfersService` e `DepositsService` (log estruturado e 503 se o provedor cair), QR code e criptografia. O `ErrorsFilter` global é a última barreira de todo o backend, em um único lugar. No frontend, a função `work()` faz o mesmo papel e exibe erros com SweetAlert2.

## 6. Seja franco sobre os limites

Isto transmite maturidade e está documentado em [ARQUITETURA.md](ARQUITETURA.md) ("Limitações deliberadas"):

- O dinheiro e o e-mail são **simulados**; não há integração bancária nem saques.
- A imutabilidade protege contra a aplicação, não contra um administrador do banco com poder de alterar o esquema.
- A localização vem do navegador e **não é verificada**.
- O monitoramento é um painel sob demanda; não envia notificações.
- Em produção seriam necessários HTTPS com cookie `Secure`, política de retenção de dados, backups e gestão de chaves.

## 7. Se houver mais tempo, o que viria a seguir

- Provedor real de pagamento com webhook assinado e conciliação externa.
- Tela para listar e encerrar sessões individualmente.
- Alertas ativos (e-mail/Slack) a partir das métricas.
- Reversão parcial e prazo máximo para devolução, conforme a regra de negócio real.

## 8. Mapa rápido do código

```text
backend/
├── migrations/        modelo de dados (SQL comentado)
├── src/
│   ├── main.ts        inicialização e segurança HTTP
│   ├── app.module.ts  composição + guard, filtro e pipe globais
│   ├── operator.ts    comando local: criar master, depositar
│   ├── common/        banco, auditoria, limite de tentativas, segurança, DTOs, HTTP
│   ├── auth/          cadastro, login, 2FA, recuperação de senha
│   ├── wallet/        razão, transferência, devolução, depósito, idempotência
│   └── admin/         consultas do master (auditor)
└── test/              unitários e integração
frontend/app/          page.tsx (telas) e alerts.ts (SweetAlert2)
```
