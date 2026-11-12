-- ============================================================================
-- 011 — Régua de cobrança, limite diário, opt-out, alerta de WhatsApp,
--       página pública da fatura e registro das execuções do motor.
-- ============================================================================

-- Régua: dias ANTES e DEPOIS do vencimento em que o cliente recebe lembrete.
-- A mensagem do dia do vencimento continua existindo independente disso.
-- Modelos NULL = usa o texto padrão do sistema (src/lib/template.ts).
ALTER TABLE settings
    ADD COLUMN reminder_days_before INTEGER[] NOT NULL DEFAULT '{3}',
    ADD COLUMN reminder_days_after  INTEGER[] NOT NULL DEFAULT '{3,7}',
    ADD COLUMN reminder_template    TEXT,
    ADD COLUMN overdue_template     TEXT,
    -- Proteção do chip: teto de mensagens automáticas por dia.
    ADD COLUMN daily_message_limit  INTEGER NOT NULL DEFAULT 150
        CHECK (daily_message_limit BETWEEN 1 AND 1000),
    -- Preenchido quando o motor encontra o WhatsApp desconectado (alerta no
    -- painel + e-mail). Volta a NULL quando a conexão é restabelecida.
    ADD COLUMN whatsapp_disconnected_at TIMESTAMPTZ;

-- Lembretes já enviados: offset_days negativo = antes do vencimento,
-- positivo = depois. A PK garante um único lembrete por fatura por dia da régua.
CREATE TABLE charge_reminders (
    charge_id   UUID NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
    offset_days INTEGER NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (charge_id, offset_days)
);

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'REMINDER';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'OVERDUE_REMINDER';

-- Cliente que pediu para não receber mais mensagens.
ALTER TABLE clients ADD COLUMN whatsapp_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Página pública da fatura (/f/<token>): token aleatório de 128 bits, que não
-- revela o id interno. O DEFAULT volátil dá um token próprio a cada linha
-- existente e a cada fatura nova.
ALTER TABLE charges
    ADD COLUMN public_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');
CREATE UNIQUE INDEX idx_charges_public_token ON charges (public_token);

-- Dia em que o Pix atual foi gerado. O Pix do Mercado Pago expira no fim do
-- dia do vencimento: lembretes de fatura atrasada precisam gerar um novo.
ALTER TABLE charges ADD COLUMN pix_generated_on DATE;

-- Execuções do motor de cobrança (monitoramento: /health/deep).
CREATE TABLE engine_runs (
    id          BIGSERIAL PRIMARY KEY,
    ran_on      DATE NOT NULL,
    ok          BOOLEAN NOT NULL,
    report      JSONB,
    error       TEXT,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_engine_runs_finished ON engine_runs (finished_at DESC);
