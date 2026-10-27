-- =============================================================================
-- 002_password_reset: recuperação de senha por link.
--
-- Cada linha é um link de redefinição ainda não usado. Como funciona:
--   * a aplicação gera um token aleatório de 256 bits e o envia por e-mail;
--   * aqui fica só o SHA-256 dele, então vazar esta tabela não dá links válidos;
--   * o token vale 7 minutos (expires_at) e é de uso ÚNICO: ao redefinir, a linha
--     é apagada com DELETE ... RETURNING, de modo que duas tentativas simultâneas
--     com o mesmo link não conseguem as duas;
--   * um novo pedido apaga os anteriores do mesmo usuário (ver o índice abaixo).
-- =============================================================================
CREATE TABLE password_resets(
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Acelera a invalidação dos links antigos do usuário (novo pedido, troca de senha
-- ou troca do autenticador).
CREATE INDEX password_resets_user ON password_resets(user_id);
INSERT INTO schema_migrations(version) VALUES('002_password_reset');
