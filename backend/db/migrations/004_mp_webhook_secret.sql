-- Assinatura secreta dos webhooks do Mercado Pago (painel Suas integrações →
-- Webhooks → Assinatura secreta), usada para validar o header x-signature.
-- Criptografada em repouso como os demais segredos (AES-256-GCM).
ALTER TABLE settings ADD COLUMN mp_webhook_secret_enc TEXT;
