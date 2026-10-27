-- =============================================================================
-- 003_notifications: avisos para o usuário sobre dinheiro recebido.
--
-- Uma notificação nasce NA MESMA TRANSAÇÃO do movimento que a originou
-- (transferência recebida ou devolução recebida). Assim ela existe se, e somente
-- se, o dinheiro realmente se moveu: um rollback desfaz as duas coisas.
--
-- Diferente de movements/entries (históricos imutáveis), esta tabela PRECISA de
-- UPDATE: marcar uma notificação como lida grava `read_at`. Por isso a API recebe
-- permissão de UPDATE aqui (ver migrate.ts). O fato financeiro continua
-- intocável; a notificação é só um aviso sobre ele.
--
-- "Lida" não apaga a linha: guarda-se QUANDO foi lida (read_at), e a listagem
-- mostra apenas as pendentes (read_at IS NULL).
-- =============================================================================
CREATE TABLE notifications(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),         -- quem é avisado
 kind text NOT NULL CHECK(kind IN ('transfer_received','refund_received')),
 movement_id uuid NOT NULL REFERENCES movements(id), -- de onde vêm valor, data e quem enviou
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,                                -- NULL = ainda não lida
 -- Um movimento avisa cada pessoa no máximo uma vez, mesmo sob repetição de requisição.
 UNIQUE(user_id, movement_id)
);
-- Índice PARCIAL: só indexa as não lidas, que são as consultadas (contador do
-- sino e página). Continua pequeno mesmo com muito histórico de lidas.
CREATE INDEX notifications_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
INSERT INTO schema_migrations(version) VALUES('003_notifications');
