# API da carteira

Base local: `http://localhost:3080/api`. Respostas JSON, com `Cache-Control: no-store` e `X-Request-Id` gerado pelo servidor. Datas em UTC; interface mostra o horário local. Valores monetários são centavos inteiros em BRL; campos bigint podem ser devolvidos como strings.

POST exige `Origin: http://localhost:3080`, `Content-Type: application/json` e `X-Wallet-Request: 1`. Também é aceita a origem `http://127.0.0.1:3080`. O cookie `wallet_session` é HttpOnly, SameSite=Strict e limitado ao caminho `/api`. O cliente deve conservar os cookies recebidos.

| Método e rota | Corpo / parâmetros | Acesso |
|---|---|---|
| GET `/health` | — | Público |
| POST `/auth/register` | `name`, `email`, `password` (12–128 caracteres) | Público |
| POST `/auth/login` | `email`, `password`, `location` opcional | Público; retorna estágio `setup` ou `challenge` |
| POST `/auth/forgot-password` | `email` | Público; resposta idêntica para conta existente ou não; link válido por 7 minutos |
| POST `/auth/reset-password` | `token` (64 hex), `password` (12–128) | Público; token de uso único; encerra todas as sessões e mantém o 2FA exigido |
| GET `/auth/status` | — | Sessão parcial ou completa |
| GET `/auth/setup` | — | Sessão de configuração; retorna QR, chave e URI |
| POST `/auth/verify` | `code` TOTP ou recuperação | Sessão parcial; retorna usuário e cookie completo |
| POST `/auth/logout` | `{}` | Sessão parcial ou completa |
| POST `/auth/rotate` | `password`, `code` | Sessão completa; revoga sessões e exige novo cadastro de 2FA |
| GET `/wallet` | — | Usuário; saldo da própria carteira |
| GET `/wallet/statement` | `page`, padrão 1 | Usuário; 20 itens por página |
| POST `/transfers` | `recipientEmail`, `amount` | Usuário; exige `Idempotency-Key` |
| POST `/transfers/:id/refund` | `{}` | Destinatário original; exige `Idempotency-Key` |
| GET `/admin/users` | `email` (nome ou e-mail), `page` | Master; 20 itens por página |
| GET `/admin/users/:id/statement` | `page` | Master |
| GET `/admin/events` | `userId`, `action`, `outcome`, `ip`, `from`, `to`, `page` | Master; 30 itens por página |
| GET `/admin/movements/:id` | — | Master; movimentação, lançamentos e eventos relacionados |
| GET `/admin/metrics` | — | Master; saúde, totais, conciliação e alertas |

Localização autorizada:

```json
{"status":"granted","latitude":-23.55,"longitude":-46.63,"accuracy":25,"capturedAt":"2026-10-27T12:00:00.000Z"}
```

Alternativas: `{"status":"denied"}`, `{"status":"unavailable"}` ou `{"status":"timeout"}`. Recusar não impede login. O servidor identifica a origem como declaração não verificada do navegador.

Transferência de R$ 25,50:

```http
POST /api/transfers
Origin: http://localhost:3080
Content-Type: application/json
X-Wallet-Request: 1
Idempotency-Key: 32844bd5-3918-46cd-89be-96a6e7a8d0e1
Cookie: wallet_session=<sessao-completa>

{"recipientEmail":"destinatario@example.com","amount":2550}
```

Guarde a identificação da solicitação até receber uma resposta definitiva. Se houver falha de rede, repita com a mesma chave e corpo. Repetir uma chave com dados diferentes retorna 409. O destinatário deve ser um usuário comum, diferente do remetente.

Devolução é integral, executada pelo destinatário com saldo suficiente. O registro original permanece e é relacionado ao novo registro. Não há saque bancário, depósito público, promoção de usuário a master ou alteração direta de saldo.

Erros: 400 para validação/saldo; 401 para credencial, código ou sessão inválida; 403 para acesso proibido; 404 para recurso ausente; 409 para duplicidade/conflito; 429 para limite de tentativas; 500 para falha interna sem detalhes sensíveis. Respostas de erro incluem `message` e `correlationId`.
