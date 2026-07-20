-- Assinatura da PLATAFORMA (Cobrai cobrando o usuário do SaaS), não confundir
-- com o gateway que cada usuário configura para cobrar os clientes dele.
--
-- Ciclo de vida:
--   TRIALING  → conta recém-criada, acesso liberado até trial_ends_at
--   ACTIVE    → mensalidade em dia (evento PAYMENT_RECEIVED/CONFIRMED do Asaas)
--   PAST_DUE  → mensalidade vencida (PAYMENT_OVERDUE) — acesso bloqueado na hora
--   CANCELED  → assinatura encerrada
CREATE TYPE subscription_status AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

ALTER TABLE users
    ADD COLUMN subscription_status    subscription_status NOT NULL DEFAULT 'TRIALING',
    ADD COLUMN trial_ends_at          TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
    ADD COLUMN paid_until             TIMESTAMPTZ,
    ADD COLUMN asaas_customer_id      TEXT,
    ADD COLUMN asaas_subscription_id  TEXT;

-- O webhook da plataforma localiza o usuário pelo id da assinatura no Asaas.
CREATE INDEX idx_users_asaas_subscription ON users (asaas_subscription_id);
