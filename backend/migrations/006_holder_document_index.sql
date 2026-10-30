-- =============================================================================
-- 006_holder_document_index: apoio à regra "um documento = um usuário".
--
-- Ao cadastrar uma conta, o serviço confere se o CPF/CNPJ do titular já está
-- vinculado a OUTRO usuário (consulta por documento). Sem o índice, essa
-- conferência varre a tabela inteira de contas.
-- =============================================================================
CREATE INDEX bank_accounts_document ON bank_accounts(holder_document);

INSERT INTO schema_migrations(version) VALUES('006_holder_document_index');
