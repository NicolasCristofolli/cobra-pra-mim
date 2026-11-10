-- Papel do usuário. ADMIN tem acesso liberado sem assinatura.
-- Só se cria admin pelo script src/db/create-admin.ts, nunca pelo cadastro.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'
    CHECK (role IN ('USER', 'ADMIN'));

-- Recuperação de senha. Guarda só o SHA-256 do token: quem lê o banco não
-- consegue usar um link pendente.
CREATE TABLE password_reset_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    requested_ip TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens (user_id, created_at DESC);
