import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { queryOne } from '../../db';
import { env } from '../../config/env';
import { decrypt, encrypt, maskSecret } from '../../lib/crypto';
import { asyncHandler, AppError } from '../../lib/errors';
import { DEFAULT_OVERDUE_TEMPLATE, DEFAULT_REMINDER_TEMPLATE } from '../../lib/template';
import type { AppDeps } from '../../services/deps';

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
  /** Régua: dias antes/depois do vencimento com lembrete. */
  reminder_days_before: number[];
  reminder_days_after: number[];
  /** NULL = modelo padrão do sistema. */
  reminder_template: string | null;
  overdue_template: string | null;
  daily_message_limit: number;
  whatsapp_disconnected_at: Date | null;
}

export async function findSettingsByUserId(userId: string): Promise<SettingsRow | null> {
  return queryOne<SettingsRow>('SELECT * FROM settings WHERE user_id = $1', [userId]);
}

// Dias da régua: inteiros de 1 a 60, sem repetição, no máximo 5 por lado.
const reminderDays = z
  .array(z.number().int().min(1).max(60))
  .max(5, 'Use no máximo 5 lembretes')
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

// Os campos de WhatsApp NÃO são editáveis por aqui: a conexão é gerenciada
// pelas rotas /whatsapp (QR Code) e a instância é derivada do próprio userId.
const updateSchema = z.object({
  gatewayProvider: z.enum(['ASAAS', 'MERCADO_PAGO']).nullable().optional(),
  // undefined = não mexer; string vazia/null = limpar; valor = substituir
  gatewayApiKey: z.string().trim().nullable().optional(),
  mpWebhookSecret: z.string().trim().nullable().optional(),
  messageTemplate: z.string().trim().min(5).max(4000).optional(),
  paidTemplate: z.string().trim().min(5).max(4000).optional(),
  reminderTemplate: z.string().trim().min(5).max(4000).optional(),
  overdueTemplate: z.string().trim().min(5).max(4000).optional(),
  reminderDaysBefore: reminderDays.optional(),
  reminderDaysAfter: reminderDays.optional(),
  dailyMessageLimit: z.number().int().min(1).max(1000).optional()
});

/** Resultado da tentativa de cadastrar o webhook no gateway pela API. */
type WebhookAutoConfig = { status: 'configured' } | { status: 'failed'; error: string } | null;

function serialize(row: SettingsRow, webhookAutoConfig: WebhookAutoConfig = null) {
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
    webhookUrl: webhookUrlFor(row.user_id),
    messageTemplate: row.message_template,
    paidTemplate: row.paid_template,
    reminderTemplate: row.reminder_template ?? DEFAULT_REMINDER_TEMPLATE,
    overdueTemplate: row.overdue_template ?? DEFAULT_OVERDUE_TEMPLATE,
    reminderDaysBefore: row.reminder_days_before,
    reminderDaysAfter: row.reminder_days_after,
    dailyMessageLimit: row.daily_message_limit,
    // Só vem preenchido na resposta de quem acabou de salvar a chave/segredo.
    webhookAutoConfig
  };
}

function webhookUrlFor(userId: string): string {
  return `${env.appUrl.replace(/\/$/, '')}/webhooks/payments/${userId}`;
}

export default function settingsRouter(deps: Pick<AppDeps, 'gatewayFactory'>): Router {
  const router = Router();

  /**
   * Cadastra o webhook de pagamento no gateway pela API (hoje, só o Asaas
   * oferece). Falhar aqui não impede salvar: o usuário ainda pode configurar
   * à mão pelo tutorial.
   */
  async function autoConfigureWebhook(row: SettingsRow): Promise<WebhookAutoConfig> {
    const gateway = deps.gatewayFactory(row);
    if (!gateway?.registerWebhook) return null;
    try {
      const owner = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [
        row.user_id
      ]);
      await gateway.registerWebhook({
        url: webhookUrlFor(row.user_id),
        authToken: decrypt(row.webhook_secret_enc),
        email: owner?.email ?? ''
      });
      return { status: 'configured' };
    } catch (error) {
      console.warn('[settings] não foi possível cadastrar o webhook no gateway:', error);
      return { status: 'failed', error: (error as Error).message.slice(0, 300) };
    }
  }

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
           gateway_provider      = $2,
           gateway_api_key_enc   = $3,
           mp_webhook_secret_enc = $4,
           message_template      = $5,
           paid_template         = $6,
           reminder_template     = $7,
           overdue_template      = $8,
           reminder_days_before  = $9,
           reminder_days_after   = $10,
           daily_message_limit   = $11,
           updated_at            = now()
         WHERE user_id = $1
         RETURNING *`,
        [
          req.userId,
          data.gatewayProvider === undefined ? current.gateway_provider : data.gatewayProvider,
          encryptOrKeep(data.gatewayApiKey, current.gateway_api_key_enc),
          encryptOrKeep(data.mpWebhookSecret, current.mp_webhook_secret_enc),
          data.messageTemplate ?? current.message_template,
          data.paidTemplate ?? current.paid_template,
          data.reminderTemplate ?? current.reminder_template,
          data.overdueTemplate ?? current.overdue_template,
          data.reminderDaysBefore ?? current.reminder_days_before,
          data.reminderDaysAfter ?? current.reminder_days_after,
          data.dailyMessageLimit ?? current.daily_message_limit
        ]
      );

      // Chave nova ou troca de provedor: tenta deixar o webhook pronto sozinho.
      const gatewayChanged =
        Boolean(data.gatewayApiKey) || (data.gatewayProvider != null && data.gatewayProvider !== current.gateway_provider);
      const webhookAutoConfig = gatewayChanged ? await autoConfigureWebhook(updated!) : null;

      res.json(serialize(updated!, webhookAutoConfig));
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
      // Segredo novo: atualiza também no gateway, quando ele permite por API.
      res.json(serialize(updated, await autoConfigureWebhook(updated)));
    })
  );

  return router;
}
