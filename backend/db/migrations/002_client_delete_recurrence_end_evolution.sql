-- ============================================================================
-- 002 — Exclusão de cliente sem 409, data-limite de recorrência e
--       unificação do WhatsApp na Evolution API.
--
-- ATENÇÃO: o runner de migrations divide o arquivo por ponto-e-vírgula.
-- Não use ponto-e-vírgula dentro de comentários.
--
--  * charges.client_id passa a aceitar NULL com ON DELETE SET NULL: excluir
--    um cliente desvincula as faturas (o histórico financeiro é preservado
--    como registro "órfão"). A aplicação cancela as faturas em aberto na
--    mesma transação da exclusão.
--  * charges.recurrence_end_date: última data de vencimento que uma série
--    recorrente pode gerar (NULL = sem limite). O motor de cobrança para de
--    materializar ciclos cujo vencimento ultrapasse essa data.
--  * Z-API descontinuada: configurações existentes com ZAPI são zeradas para
--    que o usuário reconfigure com a Evolution API (as credenciais Z-API não
--    servem para a Evolution).
-- ============================================================================

ALTER TABLE charges ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE charges DROP CONSTRAINT charges_client_id_fkey;

ALTER TABLE charges ADD CONSTRAINT charges_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE charges ADD COLUMN recurrence_end_date DATE;

UPDATE settings
   SET whatsapp_provider         = NULL,
       whatsapp_base_url         = NULL,
       whatsapp_instance         = NULL,
       whatsapp_token_enc        = NULL,
       whatsapp_client_token_enc = NULL
 WHERE whatsapp_provider = 'ZAPI';
