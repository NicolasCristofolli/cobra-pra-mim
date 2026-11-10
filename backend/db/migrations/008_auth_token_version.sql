-- Versão da sessão: o JWT carrega o valor do login, e incrementar revoga todos
-- os tokens do usuário (sair de todos os dispositivos, troca de senha).
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- Limites de tamanho também no banco (defesa em profundidade).
ALTER TABLE users ADD CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 200);
ALTER TABLE users ADD CONSTRAINT users_email_length CHECK (char_length(email) <= 254);
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
