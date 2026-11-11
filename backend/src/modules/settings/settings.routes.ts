import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { queryOne } from '../../db';
import { env } from '../../config/env';
import { decrypt, encrypt, maskSecret } from '../../lib/crypto';
import { asyncHandler, AppError } from '../../lib/errors';

export interface SettingsRow {
  id: string;
  user_id: string;
  gateway_provider: 'ASAAS' | 'MERCADO_PAGO' | null;
  gateway_api_key_enc: string | null;
  whatsapp_provider: 'EVOLUTION' | null;
  whatsapp_base_url: string | null;
  whatsapp_instance: string | null;
  whatsapp_token_enc: string | null;
  // Legado da Z-API (descontinuada) — coluna preservada, mas não exposta.
  whatsapp_client_token_enc: string | null;
  webhook_secret_enc: string;
  // Assinatura secreta dos webhooks do Mercado Pago (valida o header x-signature).
  mp_webhook_secret_enc: string | null;
  message_template: string;
  paid_template: string;
}

export async function findSettingsByUserId(userId: string): Promise<SettingsRow | null> {
  return queryOne<SettingsRow>('SELECT * FROM settings WHERE user_id = $1', [userId]);
}

// Os campos de WhatsApp NÃO são editáveis por aqui: a conexão é gerenciada
// pelas rotas /whatsapp (QR Code) e a instância é derivada do próprio userId.
const updateSchema = z.object({
  gatewayProvider: z.enum(['ASAAS', 'MERCADO_PAGO']).nullable().optional(),
  // undefined = não mexer; string vazia/null = limpar; valor = substituir
  gatewayApiKey: z.string().trim().nullable().optional(),
  mpWebhookSecret: z.string().trim().nullable().optional(),
  messageTemplate: z.string().trim().min(5).optional(),
  paidTemplate: z.string().trim().min(5).optional()
});

function serialize(row: SettingsRow) {
  const gatewayKey = row.gateway_api_key_enc ? decrypt(row.gateway_api_key_enc) : null;
  const mpSecret = row.mp_webhook_secret_enc ? decrypt(row.mp_webhook_secret_enc) : null;
  return {
    gatewayProvider: row.gateway_provider,
    gatewayApiKeySet: Boolean(row.gateway_api_key_enc),
    gatewayApiKeyMasked: gatewayKey ? maskSecret(gatewayKey) : null,
    mpWebhookSecretSet: Boolean(row.mp_webhook_secret_enc),
    mpWebhookSecretMasked: mpSecret ? maskSecret(mpSecret) : null,
    // Somente leitura: 'EVOLUTION' quando o WhatsApp está conectado via QR.
    whatsappProvider: row.whatsapp_provider,
    // O segredo é exibido para o usuário colar na configuração do gateway;
    // em repouso ele só existe criptografado (AES-256-GCM).
    webhookSecret: decrypt(row.webhook_secret_enc),
    webhookUrl: `${env.appUrl}/webhooks/payments/${row.user_id}`,
    messageTemplate: row.message_template,
    paidTemplate: row.paid_template
  };
}

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const row = await findSettingsByUserId(req.userId);
    if (!row) throw new AppError('Configurações não encontradas', 404);
    res.json(serialize(row));
  })
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const current = await findSettingsByUserId(req.userId);
    if (!current) throw new AppError('Configurações não encontradas', 404);

    const encryptOrKeep = (
      incoming: string | null | undefined,
      currentEnc: string | null
    ): string | null => {
      if (incoming === undefined) return currentEnc;
      if (incoming === null || incoming === '') return null;
      return encrypt(incoming);
    };

    const updated = await queryOne<SettingsRow>(
      `UPDATE settings SET
         gateway_provider   = $2,
         gateway_api_key_enc = $3,
         mp_webhook_secret_enc = $4,
         message_template   = $5,
         paid_template      = $6,
         updated_at         = now()
       WHERE user_id = $1
       RETURNING *`,
      [
        req.userId,
        data.gatewayProvider === undefined ? current.gateway_provider : data.gatewayProvider,
        encryptOrKeep(data.gatewayApiKey, current.gateway_api_key_enc),
        encryptOrKeep(data.mpWebhookSecret, current.mp_webhook_secret_enc),
        data.messageTemplate ?? current.message_template,
        data.paidTemplate ?? current.paid_template
      ]
    );
    res.json(serialize(updated!));
  })
);

router.post(
  '/webhook-secret/rotate',
  asyncHandler(async (req, res) => {
    const secret = randomBytes(24).toString('hex');
    const updated = await queryOne<SettingsRow>(
      `UPDATE settings SET webhook_secret_enc = $2, updated_at = now()
       WHERE user_id = $1 RETURNING *`,
      [req.userId, encrypt(secret)]
    );
    if (!updated) throw new AppError('Configurações não encontradas', 404);
    res.json(serialize(updated));
  })
);

export default router;
