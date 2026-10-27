CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL, email varchar(254) UNIQUE NOT NULL,
 password_hash text NOT NULL, role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','master')),
 totp_secret text, totp_enabled boolean NOT NULL DEFAULT false, last_totp_step bigint NOT NULL DEFAULT -1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallets(user_id uuid PRIMARY KEY REFERENCES users(id), balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 1000000000000));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), stage text NOT NULL CHECK(stage IN ('setup','challenge','full')),
 expires_at timestamptz NOT NULL, context jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE recovery_codes(user_id uuid NOT NULL REFERENCES users(id), code_hash text NOT NULL, PRIMARY KEY(user_id,code_hash));
CREATE TABLE rate_limits(key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE movements (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('deposit','transfer','refund')),
 sender_id uuid REFERENCES users(id), recipient_id uuid NOT NULL REFERENCES users(id),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),
 original_id uuid UNIQUE REFERENCES movements(id), reference varchar(160),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(sender_id IS NULL OR sender_id <> recipient_id),
 CHECK((kind='deposit' AND sender_id IS NULL AND original_id IS NULL) OR (kind='transfer' AND sender_id IS NOT NULL AND original_id IS NULL) OR (kind='refund' AND sender_id IS NOT NULL AND original_id IS NOT NULL))
);
CREATE INDEX movements_sender ON movements(sender_id,created_at DESC);
CREATE INDEX movements_recipient ON movements(recipient_id,created_at DESC);
CREATE TABLE entries (
 id bigserial PRIMARY KEY, movement_id uuid NOT NULL REFERENCES movements(id), user_id uuid NOT NULL REFERENCES wallets(user_id),
 delta bigint NOT NULL CHECK(delta <> 0), balance_after bigint NOT NULL CHECK(balance_after >= 0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(movement_id,user_id)
);
CREATE TABLE idempotency(scope text NOT NULL, key varchar(100) NOT NULL, fingerprint text NOT NULL, movement_id uuid NOT NULL REFERENCES movements(id), PRIMARY KEY(scope,key));
CREATE TABLE audit_events (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), action varchar(80) NOT NULL,
 resource text, outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')), reason varchar(160),
 correlation_id uuid NOT NULL, ip varchar(80), device varchar(500), location jsonb,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_time ON audit_events(actor_id,created_at DESC);
CREATE INDEX audit_time ON audit_events(created_at DESC);
CREATE INDEX audit_resource ON audit_events(resource);
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial and audit history is append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER movements_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON movements FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON entries FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
INSERT INTO schema_migrations(version) VALUES('001_initial');
