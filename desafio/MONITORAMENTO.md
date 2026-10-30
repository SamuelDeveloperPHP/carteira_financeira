# Monitoramento e logging

Como o sistema registra o que acontece, como se acompanha a saúde dele e como se investiga um problema. São três camadas que se complementam e se ligam por um mesmo identificador, o **`correlationId`**.

| Camada | Para quê | Onde |
|---|---|---|
| **Logs estruturados** | Operação: o que o processo está fazendo e o que falhou | Saída padrão da API (JSON, uma linha por evento) |
| **Trilha de auditoria** | Negócio e segurança: quem fez o quê, quando, de onde e com que resultado | Tabela `audit_events` (somente inclusão) |
| **Monitoramento** | Saúde: o sistema responde? os números fecham? | `/api/health`, healthchecks do Docker e painel do master |

## 1. Logs estruturados

**Formato.** Cada evento é uma linha JSON na saída padrão, o que funciona com qualquer coletor (Docker, Loki, ELK, CloudWatch) sem alterar o código.

| Evento | Quando | Campos |
|---|---|---|
| `http.request` | Ao fim de cada requisição (menos `/api/health`) | `correlationId`, `method`, `path`, `status`, `durationMs` |
| `request.failed` | Erro inesperado (status 5xx) | `correlationId`, `errorType`, `code` |
| `transfer.failed`, `refund.failed`, `deposit.provider.failed`, `pix.directory.failed`, `pix.code.delivery_failed`, `auth.qrcode.failed` | Falha que ninguém previu em um caso de uso | `correlationId`, `errorType`, `code` e contexto não sensível |
| `audit.suppressed` | Evento anônimo descartado pelo orçamento por IP | `correlationId`, `status` |
| `audit.write.failed` | A própria auditoria falhou (a resposta ao usuário sai mesmo assim) | `correlationId` |
| `mail.failed` | Falha no envio do e-mail de recuperação | `correlationId` |
| `migration.completed` | Migrações aplicadas | `version` |
| `mail.simulated`, `pix.ownership_code.simulated` | Só na demonstração (`DEMO_MAIL=true`): mostra o link e o código que iriam por e-mail | link ou código |

**Privacidade por construção.** O log **nunca** recebe corpo de requisição, cookie, token, senha, mensagem de erro ou pilha: só o **tipo** do erro e o código do driver. Mensagens e pilhas podem conter parâmetros SQL, e-mails ou tokens (ver `backend/src/common/logging/failure-log.ts`). Recusas de negócio esperadas (saldo insuficiente, destinatário inexistente) não entram no log de erros: ficam na auditoria.

**Como ler.**

```powershell
docker compose --env-file .docker.env logs -f api
docker compose --env-file .docker.env logs --tail 50 api
```

Para filtrar só falhas, procure as linhas com `request.failed` ou `.failed`. As linhas são JSON, então `jq` (ou `ConvertFrom-Json` no PowerShell) também funciona.

## 2. Correlação ponta a ponta

Toda requisição recebe um UUID (`correlationId`) em `request-logger.ts`. O mesmo valor aparece em quatro lugares:

1. no cabeçalho de resposta **`X-Request-Id`**;
2. no corpo de qualquer erro devolvido ao usuário (`correlationId`);
3. em todas as linhas de log da requisição;
4. na coluna `correlation_id` do evento de **auditoria**.

Com um valor só, dá para ir da reclamação do usuário ("deu erro, o código é…") até o log e até o evento de auditoria.

## 3. Trilha de auditoria

Tabela `audit_events` (ver `backend/migrations/001_initial.sql`):

- **Campos:** quem (`actor_id`), o quê (`action`), sobre o quê (`resource`), resultado (`outcome`: `success`, `denied` ou `failure`), motivo, `correlation_id`, IP, aparelho, localização declarada pelo navegador e detalhes. **Nunca** senhas, tokens ou códigos.
- **Ações registradas** (exemplos): `auth.login`, `auth.logout`, `auth.password.reset`, `account.register`, `transfer.completed`, `transfer.replayed`, `refund.completed`, `deposit.completed`, `pix.key.registered`, `face.enrolled`, `face.verify`, `settings.updated`, além de toda rota recusada (`POST /api/...` com `denied`).
- **Dentro da transação:** o evento de sucesso é gravado junto com a operação, então some se houver rollback. As falhas são gravadas depois do rollback, para a evidência sobreviver.
- **Imutável:** gatilhos barram UPDATE, DELETE e TRUNCATE, e o usuário do banco da API nem tem essas permissões.
- **Ruído anônimo limitado:** como a trilha não se apaga, cada IP tem um orçamento de 100 eventos sem autor a cada 15 minutos. Eventos de usuário autenticado ou de conta conhecida **nunca** são descartados.
- **Quem audita é auditado:** toda consulta do master (contas, extratos, eventos, métricas) também gera evento.

Consulta pela interface: perfil master → **Trilha de auditoria**, com filtros por usuário, ação, resultado, IP e período, e **Rastrear** uma movimentação (registro, lançamentos e eventos).

## 4. Monitoramento

**Saúde.**

- `GET /api/health` é público e só confirma que a API responde e alcança o banco (`SELECT 1`). Não revela nada sensível.
- O Docker usa healthchecks nos três serviços (`db`: `pg_isready`; `api` e `web`: requisição HTTP ao próprio serviço). O gateway só sobe depois que `api` e `web` estão saudáveis, e a API só depois da migração.
- `restart: unless-stopped` reinicia o que cair.

```powershell
docker compose --env-file .docker.env ps
```

**Painel do master** (`/monitoramento`, endpoint `GET /api/admin/metrics`):

- usuários, movimentos, soma dos saldos, soma dos depósitos e tempo de atividade da API;
- recusas e falhas nos últimos 15 minutos;
- **conciliação**, que confere duas coisas:
  1. a soma de todos os saldos é igual à soma de todos os depósitos (transferências e devoluções só movem dinheiro);
  2. o saldo de cada carteira é igual à soma dos próprios lançamentos.

**Alertas** (exibidos no painel):

| Nível | Condição |
|---|---|
| Aviso | 5 ou mais recusas ou falhas nos últimos 15 minutos (pode ser tentativa e erro ou um problema) |
| Crítico | Qualquer divergência na conciliação (indica corrupção ou bug) |

## 5. Como investigar um incidente

1. Pegue o `correlationId` que o usuário viu na mensagem de erro (ou o `X-Request-Id` da resposta).
2. Procure nos logs: `docker compose --env-file .docker.env logs api` e filtre pelo valor. A linha `http.request` mostra rota, status e duração; se for 5xx, `request.failed` traz o tipo do erro.
3. No painel do master, filtre a **Trilha de auditoria** pelo usuário (ou procure o `correlation_id`) para ver o resultado de negócio.
4. Se envolver dinheiro, use **Rastrear** na movimentação e confira o painel de **Monitoramento** para ver se a conciliação continua sem divergências.

## 6. Limites e evolução

Honestidade sobre o que ainda não existe:

- **Logs só na saída padrão do Docker**, sem coletor central nem rotação configurada. Em produção: enviar para Loki, ELK ou o serviço de nuvem, com retenção definida.
- **Sem endpoint de métricas no formato Prometheus** (`/metrics`). Os indicadores são consultados sob demanda pelo painel do master. Próximo passo: exportar contadores e histogramas (requisições, latência, falhas, transferências) e um alerta no Alertmanager.
- **Alertas só visuais**, sem envio por e-mail ou Slack.
- **Sem rastreamento distribuído** (tracing): o `correlationId` cobre um serviço só, o que basta enquanto a API é um único processo.
- **Sem nível de log configurável**: a API registra o essencial e nada de depuração, o que evita vazamento acidental.
