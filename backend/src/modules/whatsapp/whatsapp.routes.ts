import { Router } from 'express';
import { query } from '../../db';
import { AppError, asyncHandler } from '../../lib/errors';
import {
  ensureInstance,
  getConnectionState,
  getQrCode,
  instanceNameFor,
  logoutInstance,
  type EvolutionConnectionState
} from '../../services/whatsapp/evolution-manager';

/**
 * Conexão do WhatsApp via QR Code (Evolution API).
 *
 * Todas as rotas operam SOMENTE sobre a instância do usuário autenticado
 * (nome derivado de req.userId no servidor). Nenhum parâmetro de instância é
 * aceito do cliente — um usuário não tem como alcançar a sessão de outro.
 */

export type WhatsappStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'NOT_CREATED';

function toStatus(state: EvolutionConnectionState | null): WhatsappStatus {
  switch (state) {
    case 'open':
      return 'CONNECTED';
    case 'connecting':
      return 'CONNECTING';
    case 'close':
      return 'DISCONNECTED';
    default:
      return 'NOT_CREATED';
  }
}

/** Liga/desliga o canal nas settings — é o que o motor de cobrança consulta. */
async function setWhatsappEnabled(userId: string, enabled: boolean): Promise<void> {
  await query(
    `UPDATE settings
        SET whatsapp_provider = $2::whatsapp_provider,
            whatsapp_instance = $3,
            updated_at = now()
      WHERE user_id = $1
        -- /whatsapp/status é consultado em polling: só grava quando muda.
        AND (whatsapp_provider IS DISTINCT FROM $2::whatsapp_provider
             OR whatsapp_instance IS DISTINCT FROM $3)`,
    [userId, enabled ? 'EVOLUTION' : null, enabled ? instanceNameFor(userId) : null]
  );
}

const router = Router();

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const state = await getConnectionState(req.userId);
    const status = toStatus(state);
    // Mantém as settings em sincronia: conectado = canal ativo para o motor.
    if (status === 'CONNECTED') await setWhatsappEnabled(req.userId, true);
    res.json({ status });
  })
);

router.post(
  '/connect',
  asyncHandler(async (req, res) => {
    await ensureInstance(req.userId);

    const state = await getConnectionState(req.userId);
    if (state === 'open') {
      await setWhatsappEnabled(req.userId, true);
      res.json({ connected: true, qrcode: null, pairingCode: null });
      return;
    }

    const qr = await getQrCode(req.userId);
    if (!qr.base64) {
      throw new AppError(
        'A Evolution ainda não devolveu o QR Code. Aguarde alguns segundos e tente de novo.',
        502
      );
    }
    res.json({ connected: false, qrcode: qr.base64, pairingCode: qr.pairingCode });
  })
);

router.post(
  '/disconnect',
  asyncHandler(async (req, res) => {
    await logoutInstance(req.userId);
    await setWhatsappEnabled(req.userId, false);
    res.json({ ok: true });
  })
);

export default router;
