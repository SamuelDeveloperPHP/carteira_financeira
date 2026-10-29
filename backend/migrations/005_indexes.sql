-- =============================================================================
-- 005_indexes: índices que faltavam para as consultas mais frequentes.
--
--   entries(user_id, id DESC): o extrato e os relatórios filtram os lançamentos
--     de UM usuário e ordenam do mais novo ao mais antigo. O único índice de
--     `entries` começava por movement_id, então a consulta fazia varredura da
--     tabela inteira (Seq Scan), que cresce a cada movimento de qualquer usuário.
--
--   rate_limits(expires_at): a limpeza das janelas vencidas apaga por validade.
-- =============================================================================
CREATE INDEX entries_user ON entries(user_id, id DESC);
CREATE INDEX rate_limits_expires ON rate_limits(expires_at);

INSERT INTO schema_migrations(version) VALUES('005_indexes');
