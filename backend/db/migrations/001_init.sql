-- ============================================================================
-- Cobra pra mim — schema inicial (PostgreSQL 14+)
--
-- Decisões de modelagem:
--  * Todas as PKs são UUID (gen_random_uuid, nativo no PG 13+).
--  * Multi-tenant por linha: toda tabela de dados carrega user_id e TODA
--    query da aplicação filtra por ele (proteção contra IDOR na camada de
--    repositório + FKs com CASCADE amarradas ao dono).
--  * clients NÃO tem unicidade de nome nem de telefone: duas pessoas podem
--    ter o mesmo nome e um telefone comercial pode ser compartilhado.
--    A identidade é exclusivamente o UUID interno.
--  * charges.series_id agrupa uma série recorrente (a 1ª fatura da série usa
--    o próprio id). UNIQUE(series_id, due_date) torna o motor de cobrança
--    idempotente: nunca nascem duas faturas para o mesmo ciclo.
--  * Valores monetários em centavos (INTEGER) — sem ponto flutuante.
--  * Segredos (chaves de gateway/WhatsApp e token do webhook) são gravados
--    criptografados com AES-256-GCM pela aplicação (colunas *_enc).
-- ============================================================================

CREATE TYPE charge_status AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELED');
CREATE TYPE recurrence_kind AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'YEARLY');
CREATE TYPE gateway_provider AS ENUM ('ASAAS', 'MERCADO_PAGO');
CREATE TYPE whatsapp_provider AS ENUM ('EVOLUTION', 'ZAPI');
CREATE TYPE notification_kind AS ENUM ('CHARGE', 'PAYMENT_CONFIRMED');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    -- Somente dígitos, com DDI (ex.: 5551999998888). Duplicidade permitida
    -- por design: o UUID é a identidade, não o telefone.
    phone      TEXT NOT NULL,
    email      TEXT,
    document   TEXT,          -- CPF/CNPJ, opcional
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT clients_phone_digits CHECK (phone ~ '^[0-9]{8,15}$')
);

CREATE INDEX idx_clients_user            ON clients (user_id);
CREATE INDEX idx_clients_user_name       ON clients (user_id, name);
CREATE INDEX idx_clients_user_phone      ON clients (user_id, phone);
CREATE TABLE charges (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- RESTRICT preserva o histórico completo de faturas: um cliente com
    -- cobranças não pode ser apagado (a API devolve 409 amigável).
    client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    series_id         UUID NOT NULL,
    description       TEXT NOT NULL,
    amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
    due_date          DATE NOT NULL,
    status            charge_status NOT NULL DEFAULT 'PENDING',
    recurrence        recurrence_kind NOT NULL DEFAULT 'NONE',
    -- Dia-âncora para recorrência mensal/anual: uma série criada no dia 31
    -- cobra 28/29 em fevereiro e volta ao 31 em março.
    anchor_day        SMALLINT CHECK (anchor_day BETWEEN 1 AND 31),
    paid_at           TIMESTAMPTZ,
    -- Valor líquido informado pelo gateway no webhook (descontadas as taxas).
    net_amount_cents  INTEGER,
    gateway_charge_id TEXT,
    pix_copy_paste    TEXT,
    pix_qr_code_url   TEXT,
    invoice_url       TEXT,
    last_notified_at  TIMESTAMPTZ,
    -- Marca que a próxima fatura da série já foi materializada (idempotência
    -- do motor em conjunto com o UNIQUE abaixo).
    next_generated    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT charges_series_cycle_unique UNIQUE (series_id, due_date)
);

CREATE INDEX idx_charges_user_status   ON charges (user_id, status);
CREATE INDEX idx_charges_user_due      ON charges (user_id, due_date);
CREATE INDEX idx_charges_client        ON charges (client_id);
CREATE INDEX idx_charges_gateway_id    ON charges (gateway_charge_id);
CREATE INDEX idx_charges_series        ON charges (series_id, due_date DESC);

CREATE TABLE settings (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    gateway_provider          gateway_provider,
    gateway_api_key_enc       TEXT,
    whatsapp_provider         whatsapp_provider,
    whatsapp_base_url         TEXT,
    whatsapp_instance         TEXT,
    whatsapp_token_enc        TEXT,
    whatsapp_client_token_enc TEXT,
    webhook_secret_enc        TEXT NOT NULL,
    message_template          TEXT NOT NULL,
    paid_template             TEXT NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    charge_id  UUID REFERENCES charges(id) ON DELETE SET NULL,
    kind       notification_kind NOT NULL,
    phone      TEXT NOT NULL,
    message    TEXT NOT NULL,
    success    BOOLEAN NOT NULL,
    error      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user   ON notification_logs (user_id, created_at DESC);
CREATE INDEX idx_notifications_charge ON notification_logs (charge_id);
