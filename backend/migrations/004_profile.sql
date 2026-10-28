-- =============================================================================
-- 004_profile: perfil do usuário (dados bancários e chaves Pix, preferências de
-- segurança, reconhecimento facial) e trilha de acesso (login/logout).
--
-- Decisões:
--   * Dados bancários e chaves Pix são cadastro do usuário, NÃO movimentam o
--     razão financeiro: por isso a API pode alterá-los (diferente de movements).
--   * Template facial é dado biométrico sensível (LGPD, art. 5º, II): fica numa
--     tabela própria, CIFRADO na aplicação (AES-256-GCM), e nunca é devolvido.
--   * A trilha de acesso é quase append-only: um gatilho só deixa a API preencher
--     o encerramento (ended_at/end_reason) uma única vez.
-- =============================================================================

-- Preferências de segurança. Uma linha por usuário, criada sob demanda.
CREATE TABLE user_settings(
 user_id uuid PRIMARY KEY REFERENCES users(id),
 -- Sinalizador para o aplicativo nativo (biometria do aparelho). O servidor só
 -- guarda a preferência; a biometria em si nunca chega aqui.
 biometric_enabled boolean NOT NULL DEFAULT false,
 -- Quando falso, o servidor descarta a localização enviada no login.
 geolocation_enabled boolean NOT NULL DEFAULT true,
 face_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- Modelo facial (vetor de 128 números), cifrado. Apagar a linha desativa o recurso.
CREATE TABLE face_templates(
 user_id uuid PRIMARY KEY REFERENCES users(id),
 template text NOT NULL,
 enrolled_at timestamptz NOT NULL DEFAULT now()
);

-- Contas bancárias do usuário (pode haver várias). A mesma conta (banco +
-- agência + número) não pode pertencer a dois usuários.
CREATE TABLE bank_accounts(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 bank_code char(3) NOT NULL CHECK(bank_code ~ '^[0-9]{3}$'),   -- código COMPE
 agency varchar(5) NOT NULL CHECK(agency ~ '^[0-9]{4,5}$'),
 account_number varchar(13) NOT NULL CHECK(account_number ~ '^[0-9]{3,12}-?[0-9Xx]?$'),
 account_type text NOT NULL CHECK(account_type IN ('checking','savings','payment')),
 -- CPF (11) ou CNPJ (14) do titular, só dígitos. Uma chave Pix de CPF/CNPJ
 -- precisa ser o documento do titular da conta (regra do arranjo Pix).
 holder_document varchar(14) NOT NULL CHECK(holder_document ~ '^([0-9]{11}|[0-9]{14})$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bank_code,agency,account_number)
);
CREATE INDEX bank_accounts_user ON bank_accounts(user_id);

-- Chaves Pix. UNIQUE(key_value) é GLOBAL: uma chave existe em uma única conta
-- (como no DICT do Banco Central), o que também garante que não se repete
-- dentro do mesmo banco.
--   pending  = aguardando prova de posse (e-mail/telefone) ou resposta do diretório
--   approved = registrada no diretório
--   rejected = recusada
CREATE TABLE pix_keys(
 id uuid PRIMARY KEY,
 bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 key_type text NOT NULL CHECK(key_type IN ('cpf','cnpj','email','phone','evp')),
 key_value varchar(77) NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 protocol varchar(40) NOT NULL,                 -- protocolo devolvido pelo diretório
 reason varchar(160),                           -- motivo, quando recusada
 proof_hash text,                               -- SHA-256 do código de posse
 proof_expires_at timestamptz,
 proof_attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz
);
CREATE INDEX pix_keys_account ON pix_keys(bank_account_id);
CREATE INDEX pix_keys_user ON pix_keys(user_id);

-- Trilha de acesso: uma linha por login completo (senha + 2FA).
CREATE TABLE access_log(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL,                      -- liga ao registro em "sessions" (só o hash)
 started_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 ended_at timestamptz,
 end_reason text CHECK(end_reason IN ('logout','expired','revoked')),
 ip varchar(80),
 device varchar(500),
 location jsonb NOT NULL DEFAULT '{"status":"unavailable"}'
);
CREATE INDEX access_user_time ON access_log(user_id,started_at DESC);
CREATE INDEX access_open ON access_log(user_id) WHERE ended_at IS NULL;

-- Só o encerramento muda, e uma única vez. Qualquer outra alteração é recusada.
CREATE FUNCTION access_log_close_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.ended_at IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.ip IS DISTINCT FROM OLD.ip
    OR NEW.device IS DISTINCT FROM OLD.device OR NEW.location IS DISTINCT FROM OLD.location
 THEN RAISE EXCEPTION 'Access log only allows closing an open entry'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER access_log_close BEFORE UPDATE ON access_log FOR EACH ROW EXECUTE FUNCTION access_log_close_only();
CREATE FUNCTION access_log_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Access log is append-only'; END $$;
CREATE TRIGGER access_log_nodelete BEFORE DELETE OR TRUNCATE ON access_log FOR EACH STATEMENT EXECUTE FUNCTION access_log_no_delete();

INSERT INTO schema_migrations(version) VALUES('004_profile');
