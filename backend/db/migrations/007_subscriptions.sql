-- Assinatura da PLATAFORMA em tabelas próprias (substitui as colunas da 005).
-- Fluxo: plano escolhido (PENDING_PAYMENT) -> pagamento confirmado pelo
-- webhook do Asaas (ACTIVE) -> vencido dentro da carência (PAST_DUE, só aviso)
-- -> fora da carência (bloqueio, calculado em src/services/subscription/access.ts).
--
-- ATENÇÃO: o executor de migrações separa comandos por ponto e vírgula.
-- Não use esse caractere em comentários nem em blocos DO.

CREATE TYPE platform_subscription_status AS ENUM (
    'PENDING_PAYMENT', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED'
);

CREATE TYPE platform_payment_status AS ENUM (
    'PENDING', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'FAILED'
);

CREATE TYPE billing_cycle AS ENUM ('MONTHLY', 'YEARLY');

CREATE TABLE plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    cycle       billing_cycle NOT NULL,
    grace_days  INTEGER NOT NULL DEFAULT 5 CHECK (grace_days >= 0),
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan_id                 UUID NOT NULL REFERENCES plans(id),
    status                  platform_subscription_status NOT NULL DEFAULT 'PENDING_PAYMENT',
    current_period_end      TIMESTAMPTZ,
    trial_ends_at           TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    gateway_customer_id     TEXT,
    gateway_subscription_id TEXT UNIQUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_status ON subscriptions (status, current_period_end);

CREATE TABLE subscription_payments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id    UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    gateway_payment_id TEXT NOT NULL UNIQUE,
    amount_cents       INTEGER NOT NULL,
    status             platform_payment_status NOT NULL DEFAULT 'PENDING',
    due_date           DATE NOT NULL,
    paid_at            TIMESTAMPTZ,
    checkout_url       TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_payments_sub ON subscription_payments (subscription_id, due_date DESC);

-- Idempotência do webhook: o Asaas reenvia eventos até receber 200.
CREATE TABLE platform_webhook_events (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Planos iniciais. AJUSTE OS PREÇOS antes do deploy:
--   UPDATE plans SET price_cents = 5990 WHERE code = 'mensal'
INSERT INTO plans (code, name, description, price_cents, cycle, grace_days, sort_order) VALUES
    ('mensal', 'Mensal', 'Cobranças ilimitadas, WhatsApp e Pix automáticos', 4990, 'MONTHLY', 5, 1),
    ('anual',  'Anual',  'Tudo do mensal, com 2 meses de desconto',          49900, 'YEARLY', 5, 2);

-- Contas que já existiam ganham 15 dias de cortesia (TRIALING) antes de o
-- bloqueio valer, para terem tempo de escolher o plano e pagar.
INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
SELECT u.id,
       (SELECT id FROM plans WHERE code = 'mensal'),
       'TRIALING',
       GREATEST(u.trial_ends_at, now() + interval '15 days')
  FROM users u;
