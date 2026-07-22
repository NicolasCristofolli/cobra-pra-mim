-- ============================================================================
-- 006 — Soft delete de cliente (botão "Desfazer") e bloqueio de duplicidade
--       de telefone/e-mail/CPF-CNPJ por usuário.
--
-- ATENÇÃO: o runner de migrations divide o arquivo por ponto-e-vírgula.
-- Não use ponto-e-vírgula dentro de comentários.
--
--  * clients.deleted_at: exclusão vira soft delete, para o "Desfazer" do
--    toast poder restaurar o cadastro. Toda leitura de clients passa a
--    filtrar deleted_at IS NULL na aplicação.
--  * document é normalizado para dígitos (mesmo tratamento que phone já
--    recebe) antes de aplicar a unicidade — dois cadastros com o mesmo CPF
--    formatado de jeitos diferentes (com ou sem pontuação) contam como
--    duplicata.
--  * Os três índices únicos abaixo são parciais (WHERE deleted_at IS NULL):
--    um telefone/e-mail/CPF fica livre para reuso assim que o cliente que o
--    usava é excluído.
--
-- AVISO PARA PRODUÇÃO: se já existir duplicidade de telefone/e-mail/CPF por
-- usuário nos dados atuais, a criação do índice único correspondente falha.
-- Rode a checagem de duplicados na base viva antes de aplicar esta migração
-- em produção.
-- ============================================================================

ALTER TABLE clients ADD COLUMN deleted_at TIMESTAMPTZ;

UPDATE clients SET document = regexp_replace(document, '\D', '', 'g') WHERE document IS NOT NULL;

CREATE UNIQUE INDEX clients_user_phone_unique ON clients (user_id, phone) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX clients_user_email_unique ON clients (user_id, lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX clients_user_document_unique ON clients (user_id, document) WHERE document IS NOT NULL AND deleted_at IS NULL;
