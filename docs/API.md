# API da carteira

Base local: `http://localhost:3080/api`. Respostas JSON, com `Cache-Control: no-store` e `X-Request-Id` gerado pelo servidor. Datas em UTC; interface mostra o horário local. Valores monetários são centavos inteiros em BRL; campos bigint podem ser devolvidos como strings.

POST exige `Origin: http://localhost:3080`, `Content-Type: application/json` e `X-Wallet-Request: 1`. Também é aceita a origem `http://127.0.0.1:3080`. O cookie `wallet_session` é HttpOnly, SameSite=Strict e limitado ao caminho `/api`. O cliente deve conservar os cookies recebidos.

| Método e rota | Corpo / parâmetros | Acesso |
|---|---|---|
| GET `/health` | — | Público |
| POST `/auth/register` | `name`, `email`, `password` (12–128 caracteres) | Público |
| POST `/auth/login` | `email`, `password`, `location` opcional | Público; retorna estágio `setup` ou `challenge` |
| POST `/auth/forgot-password` | `email` | Público; resposta idêntica para conta existente ou não; link válido por 7 minutos |
| POST `/auth/reset-requirements` | `token` (64 hex) | Público; `{ "faceRequired": bool }`, sem gastar o link |
| POST `/auth/reset-password` | `token` (64 hex), `password` (12–128), `face` (128 números; obrigatório se o usuário ativou o reconhecimento facial) | Público; token de uso único; encerra todas as sessões e mantém o 2FA exigido. Rosto que não confere: 403 e o link continua valendo |
| GET `/auth/status` | — | Sessão parcial ou completa |
| GET `/auth/setup` | — | Sessão de configuração; retorna QR, chave e URI |
| POST `/auth/verify` | `code` TOTP ou recuperação | Sessão parcial; retorna usuário e cookie completo |
| POST `/auth/logout` | `{}` | Sessão parcial ou completa |
| POST `/auth/rotate` | `password`, `code` | Sessão completa; revoga sessões e exige novo cadastro de 2FA |
| GET `/wallet` | — | Usuário; saldo da própria carteira |
| GET `/wallet/statement` | `page`, padrão 1 | Usuário; 20 itens por página |
| POST `/deposits` | `amount` (centavos, 1 a 1.000.000) | Usuário; adiciona saldo simulado à própria carteira; exige `Idempotency-Key`; 20 por hora |
| POST `/transfers` | `recipientEmail`, `amount` | Usuário; exige `Idempotency-Key` |
| POST `/transfers/:id/refund` | `{}` | Destinatário original; exige `Idempotency-Key` |
| GET `/notifications` | `page` | Usuário; avisos NÃO lidos (20 por página) e `unread` (total pendente). Cada item traz `message` pronta |
| GET `/notifications/count` | — | Usuário; `{ "unread": n }`, usado pelo sino |
| POST `/notifications/:id/read` | `{}` | Usuário; marca como lido e o aviso some da lista; 404 se não for seu |
| POST `/notifications/read-all` | `{}` | Usuário; marca todos como lidos e devolve `updated` e `message` |
| GET `/banking/banks` | — | Usuário; catálogo de bancos (código COMPE e nome) |
| GET `/banking/accounts` | — | Usuário; contas com suas chaves Pix e `maxKeys` |
| POST `/banking/accounts` | `bankCode`, `agency`, `accountNumber`, `accountType` (`checking`, `savings`, `payment`), `holderDocument` (CPF/CNPJ) | Usuário; várias contas; 409 se a conta já existir |
| DELETE `/banking/accounts/:id` | — | Usuário; remove a conta e suas chaves; 404 se não for sua |
| POST `/banking/accounts/:id/pix-keys` | `type` (`cpf`, `cnpj`, `email`, `phone`, `evp`), `value` (omitido em `evp`) | Usuário; status `approved` ou `pending` (e-mail/celular aguardam código); 409 se a chave já existir |
| POST `/banking/pix-keys/:id/confirm` | `code` (6 dígitos) | Usuário; conclui a prova de posse (5 tentativas, 10 minutos) |
| POST `/banking/pix-keys/:id/resend` | `{}` | Usuário; novo código |
| DELETE `/banking/pix-keys/:id` | — | Usuário; libera a chave |
| GET `/settings` | — | Usuário; `biometricEnabled`, `geolocationEnabled`, `faceEnabled` |
| PATCH `/settings` | `biometricEnabled`, `geolocationEnabled` (opcionais) | Usuário |
| POST `/settings/face` | `password`, `descriptor` (128 números), `liveness` (`right`, `left`, `down`, `up`, `smile`) | Usuário; cadastra o rosto (substitui o anterior) |
| POST `/settings/face/disable` | `password` | Usuário; apaga o modelo facial |
| GET `/access` | `page` | Usuário; trilha de acesso (10 por página): `startedAt`, `endedAt`, `endReason`, `durationSeconds`, `ip`, `device`, `location`, `current` |
| GET `/access/map` | — | Usuário; até 200 acessos com coordenadas (mapa geral) |
| GET `/admin/users` | `email` (nome ou e-mail), `page` | Master; 20 itens por página |
| GET `/admin/users/:id/statement` | `page` | Master |
| GET `/admin/events` | `userId`, `action`, `outcome`, `ip`, `from`, `to`, `page` | Master; 30 itens por página |
| GET `/admin/movements/:id` | — | Master; movimentação, lançamentos e eventos relacionados |
| GET `/admin/metrics` | — | Master; saúde, totais, conciliação e alertas |

Localização autorizada:

```json
{"status":"granted","latitude":-23.55,"longitude":-46.63,"accuracy":25,"capturedAt":"2026-10-27T12:00:00.000Z"}
```

Alternativas: `{"status":"disabled"}` (definido pelo servidor quando o usuário desligou a geolocalização), `{"status":"denied"}`, `{"status":"unavailable"}` ou `{"status":"timeout"}`. Recusar não impede login. O servidor identifica a origem como declaração não verificada do navegador.

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

Devolução é integral, executada pelo destinatário com saldo suficiente. O registro original permanece e é relacionado ao novo registro. Não há saque bancário, promoção de usuário a master ou alteração direta de saldo.

Adição de saldo (valor simulado) de R$ 50,00, somente à carteira da sessão (não existe campo de destino; enviar um é recusado com 400):

```http
POST /api/deposits
Idempotency-Key: 7d3f4a52-9c1e-4f0b-8a6d-2b5e1c9a0f33
Cookie: wallet_session=<sessao-completa>

{"amount":5000}
```

Só funciona com `DEMO_DEPOSITS=true`; caso contrário responde 403 "Depósitos simulados desabilitados.". Acima de R$ 10.000,00 responde 400.

**Notificações.** Geradas junto com o movimento: `transfer_received` (ao destinatário de uma transferência) e `refund_received` (a quem enviou a transferência devolvida). Exemplo de item: `{"id":"…","kind":"transfer_received","message":"Ana enviou R$ 10,00 para você.","amount":"1000","movementId":"…","createdAt":"…"}`. O master não tem notificações.

**Mensagens de retorno.** `POST /deposits`, `/transfers` e `/transfers/:id/refund` devolvem o movimento e um campo `message` em português, por exemplo `{"id":"…","kind":"deposit","amount":"5000","message":"Saldo adicionado à sua carteira."}`. A interface exibe essa mensagem como está.

**Perfil.** Chaves Pix seguem o formato do arranjo: CPF e CNPJ com dígitos verificadores e iguais ao documento do titular da conta; e-mail; celular `+55DDDnúmero` (ex.: `+5561999999999`); chave aleatória gerada pelo servidor. A chave é única em todo o sistema (e, portanto, em cada banco), com até 5 chaves por conta de pessoa física e 20 por conta de pessoa jurídica. E-mail e celular ficam `pending` até o código de posse (com `DEMO_MAIL=true` o código aparece no log da API). A aprovação é simulada (porta `PixDirectoryProvider`); não há chamada ao DICT do Banco Central.

**Reconhecimento facial.** O navegador devolve um vetor de 128 números depois da prova de vida; o servidor o guarda cifrado (AES-256-GCM) e nunca o devolve. Distância máxima aceita: 0,5. Na recuperação de senha o rosto soma-se ao link do e-mail. 5 tentativas por 15 minutos.

**Trilha de acesso.** Cada login completo gera um registro com IP, aparelho e localização (do navegador, não verificada). O encerramento é gravado no logout (`logout`), no vencimento (`expired`) ou quando o sistema revoga a sessão (`revoked`: troca de senha/autenticador ou limite de 5 sessões).

Erros: 400 para validação/saldo; 401 para credencial, código ou sessão inválida; 403 para acesso proibido; 404 para recurso ausente; 409 para duplicidade/conflito; 429 para limite de tentativas; 500 para falha interna sem detalhes sensíveis. Respostas de erro incluem `message` e `correlationId`.
