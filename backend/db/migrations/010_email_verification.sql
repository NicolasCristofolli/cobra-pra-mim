-- Confirmação de e-mail. NULL = ainda não confirmou: não pode assinar nem
-- usar o painel. Contas que já existiam (inclusive as que já pagam) entram
-- como confirmadas.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = created_at;

-- Mesmo desenho da recuperação de senha: só o SHA-256 do token fica no banco.
CREATE TABLE email_verification_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens (user_id, created_at DESC);
