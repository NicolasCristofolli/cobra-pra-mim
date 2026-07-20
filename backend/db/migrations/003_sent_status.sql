-- ============================================================================
-- 003 — status ENVIADO (SENT) para faturas.
--
-- ATENÇÃO: o runner de migrations divide o arquivo por ponto-e-vírgula.
-- Não use ponto-e-vírgula dentro de comentários.
--
--  * Quando a mensagem de cobrança é enviada no WhatsApp, a fatura PENDING
--    passa a SENT ("Enviada"). Faturas OVERDUE continuam OVERDUE mesmo após
--    o envio (o atraso é a informação mais importante).
--  * O runner executa cada comando fora de transação, então o ALTER TYPE
--    ADD VALUE é seguro aqui.
-- ============================================================================

ALTER TYPE charge_status ADD VALUE IF NOT EXISTS 'SENT' BEFORE 'PAID';
