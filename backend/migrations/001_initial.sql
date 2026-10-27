-- =============================================================================
-- 001_initial: modelo de dados completo da carteira financeira.
--
-- Princípios que guiam o desenho:
--   1. Dinheiro é sempre um número INTEIRO de centavos (bigint). Nunca float:
--      0.1 + 0.2 != 0.3 em ponto flutuante, e isso é inaceitável para saldos.
--   2. O que é "verdade financeira" (movements, entries) e a trilha de auditoria
--      (audit_events) são APPEND-ONLY: só se insere, nunca se altera ou apaga.
--      Um estorno é um NOVO movimento, não a edição do antigo.
--   3. As regras mais críticas (saldo >= 0, valores positivos, tipos válidos)
--      ficam no banco como CHECK. Mesmo que a aplicação tenha um bug, o banco
--      recusa o dado inválido: defesa em profundidade.
--   4. Segredos (senha, tokens, códigos) nunca são guardados em claro: só hashes
--      ou, no caso do segredo TOTP, cifrado (AES-256-GCM, feito na aplicação).
-- =============================================================================

-- Controle de versão do esquema. O migrate.ts consulta esta tabela para saber
-- quais arquivos .sql já foram aplicados e não repeti-los.
CREATE TABLE IF NOT EXISTS schema_migrations(
 version text PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);

-- Usuários. Cliente comum e master (auditor somente leitura) ficam na mesma
-- tabela, diferenciados por "role". O cadastro público nunca informa o perfil:
-- o DTO recusa o campo, e o master só nasce pelo comando local do operador.
CREATE TABLE users (
 id uuid PRIMARY KEY,                       -- UUID: não sequencial, não adivinhável
 name varchar(100) NOT NULL,
 email varchar(254) UNIQUE NOT NULL,        -- UNIQUE impede cadastro duplicado, inclusive em corrida
 password_hash text NOT NULL,               -- scrypt com salt individual ("salt:hash"), nunca a senha
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','master')),
 totp_secret text,                          -- segredo do autenticador, CIFRADO (AES-256-GCM)
 totp_enabled boolean NOT NULL DEFAULT false, -- true só depois de confirmar o primeiro código
 last_totp_step bigint NOT NULL DEFAULT -1, -- último intervalo de 30 s aceito: impede reutilizar o mesmo código
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Carteira: uma por usuário. O saldo guardado aqui é um "cache" do razão (entries),
-- atualizado na mesma transação de cada movimento. O CHECK garante saldo nunca
-- negativo e limitado a R$ 10 bilhões: nem uma falha de lógica consegue
-- deixar uma conta no vermelho.
CREATE TABLE wallets(
 user_id uuid PRIMARY KEY REFERENCES users(id),
 balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 1000000000000)
);

-- Sessões no servidor. O cookie do navegador carrega um token aleatório; aqui só
-- fica o SHA-256 dele (token_hash). Se o banco vazar, os hashes não servem como
-- cookie. "stage" modela o login em duas etapas:
--   setup     = senha ok, ainda cadastrando o autenticador
--   challenge = senha ok, falta digitar o código do 2FA
--   full      = autenticado de verdade (só este estágio acessa dinheiro)
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 stage text NOT NULL CHECK(stage IN ('setup','challenge','full')),
 expires_at timestamptz NOT NULL,           -- calculado com o relógio do banco, não da aplicação
 context jsonb NOT NULL DEFAULT '{}',       -- IP, navegador e localização do início do login
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);  -- acelera "revogar/limitar sessões do usuário"

-- Códigos de recuperação do 2FA (8 por usuário, uso único). Guardamos só o hash;
-- ao usar, a linha é apagada. A chave composta impede códigos repetidos.
CREATE TABLE recovery_codes(
 user_id uuid NOT NULL REFERENCES users(id),
 code_hash text NOT NULL,
 PRIMARY KEY(user_id,code_hash)
);

-- Limite de tentativas por janela de tempo (login, 2FA, cadastro...). Fica no
-- banco, e não na memória do processo, para valer entre reinícios e entre várias
-- instâncias da API.
CREATE TABLE rate_limits(
 key text PRIMARY KEY,                      -- ex.: "login-email:ana@x.com"
 count integer NOT NULL,
 expires_at timestamptz NOT NULL
);

-- Movimentações: o "livro" de tudo que moveu dinheiro. Imutável (ver gatilhos abaixo).
--   deposit  = entrada de fora (sem remetente)
--   transfer = de um usuário para outro
--   refund   = devolução de uma transferência anterior (aponta para ela em original_id)
CREATE TABLE movements (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('deposit','transfer','refund')),
 sender_id uuid REFERENCES users(id),       -- NULL apenas em depósito
 recipient_id uuid NOT NULL REFERENCES users(id),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000), -- sempre positivo, em centavos
 -- UNIQUE em original_id: uma transferência só pode ter UMA devolução. Mesmo duas
 -- requisições simultâneas de devolução não passam por esta trava do banco.
 original_id uuid UNIQUE REFERENCES movements(id),
 reference varchar(160),                    -- referência do provedor, nos depósitos
 created_at timestamptz NOT NULL DEFAULT now(),
 -- Ninguém transfere para si mesmo.
 CHECK(sender_id IS NULL OR sender_id <> recipient_id),
 -- Coerência de cada tipo: depósito não tem remetente nem original; transferência
 -- tem remetente e não tem original; devolução tem os dois.
 CHECK((kind='deposit' AND sender_id IS NULL AND original_id IS NULL) OR (kind='transfer' AND sender_id IS NOT NULL AND original_id IS NULL) OR (kind='refund' AND sender_id IS NOT NULL AND original_id IS NOT NULL))
);
CREATE INDEX movements_sender ON movements(sender_id,created_at DESC);
CREATE INDEX movements_recipient ON movements(recipient_id,created_at DESC);

-- Lançamentos (partida dobrada): cada movimento gera uma linha por carteira
-- afetada, com o valor assinado (delta: negativo para quem paga, positivo para
-- quem recebe) e o saldo resultante. É o extrato de cada usuário e permite
-- reconciliar: o saldo da carteira tem de bater com o último lançamento.
CREATE TABLE entries (
 id bigserial PRIMARY KEY,                  -- ordem de gravação, usada para ordenar o extrato
 movement_id uuid NOT NULL REFERENCES movements(id),
 user_id uuid NOT NULL REFERENCES wallets(user_id),
 delta bigint NOT NULL CHECK(delta <> 0),
 balance_after bigint NOT NULL CHECK(balance_after >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(movement_id,user_id)                -- no máximo um lançamento por carteira em cada movimento
);

-- Idempotência: lembra o resultado de cada requisição que move dinheiro. Se o
-- cliente repetir a mesma chave (clique duplo, retentativa de rede), devolvemos o
-- movimento original em vez de pagar duas vezes. "fingerprint" é o hash dos dados:
-- reutilizar a chave com valores diferentes é recusado (409).
CREATE TABLE idempotency(
 scope text NOT NULL,                       -- quem/qual operação, ex.: "transfer:<id do remetente>"
 key varchar(100) NOT NULL,                 -- chave enviada pelo cliente (cabeçalho Idempotency-Key)
 fingerprint text NOT NULL,
 movement_id uuid NOT NULL REFERENCES movements(id),
 PRIMARY KEY(scope,key)
);

-- Trilha de auditoria: quem fez o quê, quando, de onde e com que resultado.
-- Alimenta o painel do master e a investigação de incidentes.
CREATE TABLE audit_events (
 id bigserial PRIMARY KEY,
 actor_id uuid REFERENCES users(id),        -- NULL quando não há autor identificado (ex.: e-mail desconhecido)
 action varchar(80) NOT NULL,               -- ex.: "transfer.completed", "auth.login"
 resource text,                             -- sobre o que foi (id de usuário, movimento...)
 outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')),
 reason varchar(160),
 correlation_id uuid NOT NULL,              -- liga o evento à linha de log da mesma requisição (X-Request-Id)
 ip varchar(80),
 device varchar(500),
 location jsonb,                            -- localização informada pelo navegador (não verificada)
 details jsonb NOT NULL DEFAULT '{}',       -- dados extras; nunca senhas, tokens ou códigos
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_time ON audit_events(actor_id,created_at DESC);
CREATE INDEX audit_time ON audit_events(created_at DESC);
CREATE INDEX audit_resource ON audit_events(resource);

-- =============================================================================
-- Imutabilidade do histórico. Os gatilhos disparam ANTES de qualquer UPDATE,
-- DELETE ou TRUNCATE e abortam a operação. Valem até para o dono da tabela.
-- Além disso, o usuário do banco que a API usa (wallet_app, criado em migrate.ts)
-- nem recebe permissão de UPDATE/DELETE nestas tabelas: são duas camadas.
-- Limite honesto: um administrador do banco com poder de alterar o esquema
-- ainda poderia remover os gatilhos; isto protege contra a aplicação, não contra
-- o DBA.
-- =============================================================================
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial and audit history is append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER movements_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON movements FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON entries FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();

INSERT INTO schema_migrations(version) VALUES('001_initial');
