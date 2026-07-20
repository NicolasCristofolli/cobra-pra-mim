import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { decrypt, safeEqual } from '../../lib/crypto';
import { asyncHandler } from '../../lib/errors';
import { publish } from '../../lib/events';
import {
  findChargeForWebhook,
  markChargePaid
} from '../charges/charges.repo';
import { findSettingsByUserId } from '../settings/settings.routes';
import { sendPaymentConfirmation } from '../../services/billing-engine';
import type { AppDeps } from '../../services/deps';

const paramsSchema = z.object({ userId: z.string().uuid() });

type NormalizedEvent =
  | {
      kind: 'paid';
      gatewayChargeId: string | null;
      externalReference: string | null;
      netAmountCents: number | null;
    }
  | { kind: 'mp_check'; paymentId: string }
  | { kind: 'ignored' };

/**
 * Normaliza o corpo do webhook para um evento único, aceitando três formatos:
 *  - Asaas:        { event: "PAYMENT_RECEIVED", payment: { id, externalReference, netValue } }
 *  - Mercado Pago: { type: "payment", data: { id } }  (exige verificação na API)
 *  - Genérico:     { status: "PAID", chargeId }       (testes manuais/curl)
 */
function normalizePaymentEvent(body: unknown): NormalizedEvent {
  const payload = body as Record<string, any> | null;
  if (!payload || typeof payload !== 'object') return { kind: 'ignored' };

  // Asaas
  if (typeof payload.event === 'string' && payload.payment?.id) {
    if (payload.event === 'PAYMENT_RECEIVED' || payload.event === 'PAYMENT_CONFIRMED') {
      const netValue = payload.payment.netValue;
      return {
        kind: 'paid',
        gatewayChargeId: String(payload.payment.id),
        externalReference: payload.payment.externalReference
          ? String(payload.payment.externalReference)
          : null,
        netAmountCents:
          typeof netValue === 'number' ? Math.round(netValue * 100) : null
      };
    }
    return { kind: 'ignored' };
  }

  // Mercado Pago (notificação é só um ping — o status vem da API)
  const isMpPing =
    payload.type === 'payment' ||
    (typeof payload.action === 'string' && payload.action.startsWith('payment.'));
  if (isMpPing && payload.data?.id) {
    return { kind: 'mp_check', paymentId: String(payload.data.id) };
  }

  // Genérico
  if (payload.status === 'PAID' && (payload.chargeId || payload.externalReference)) {
    return {
      kind: 'paid',
      gatewayChargeId: payload.gatewayChargeId ? String(payload.gatewayChargeId) : null,
      externalReference: String(payload.chargeId ?? payload.externalReference),
      netAmountCents:
        typeof payload.netAmountCents === 'number'
          ? Math.round(payload.netAmountCents)
          : null
    };
  }

  return { kind: 'ignored' };
}

/**
 * Valida o header x-signature do Mercado Pago (formato "ts=...,v1=...").
 * O MP assina com HMAC-SHA256 o manifesto
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * usando a "assinatura secreta" exibida em Suas integrações → Webhooks.
 * Partes ausentes na notificação saem do manifesto (regra da doc do MP).
 */
function verifyMercadoPagoSignature(params: {
  xSignature: string;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}): boolean {
  const parts: Record<string, string> = {};
  for (const piece of params.xSignature.split(',')) {
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const ts = parts.ts;
  const hash = parts.v1;
  if (!ts || !hash) return false;

  let manifest = '';
  if (params.dataId) manifest += `id:${params.dataId.toLowerCase()};`;
  if (params.xRequestId) manifest += `request-id:${params.xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac('sha256', params.secret).update(manifest).digest('hex');
  return safeEqual(expected, hash);
}

async function verifyMercadoPagoPayment(
  paymentId: string,
  accessToken: string
): Promise<NormalizedEvent> {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago ${response.status} ao verificar pagamento ${paymentId}`);
  }
  const payment = (await response.json()) as {
    id: number;
    status: string;
    external_reference?: string;
    transaction_details?: { net_received_amount?: number };
  };
  if (payment.status !== 'approved') return { kind: 'ignored' };
  const net = payment.transaction_details?.net_received_amount;
  return {
    kind: 'paid',
    gatewayChargeId: String(payment.id),
    externalReference: payment.external_reference ?? null,
    netAmountCents: typeof net === 'number' ? Math.round(net * 100) : null
  };
}

export default function webhooksRouter(deps: AppDeps): Router {
  const router = Router();

  /**
   * Endpoint PÚBLICO chamado pelo gateway. Segurança:
   *  1. URL contém o userId (isola o tenant do evento);
   *  2. autenticação por gateway:
   *     - Asaas/genérico: token secreto no header (asaas-access-token /
   *       x-webhook-token) ou em ?token= — comparado em tempo constante;
   *     - Mercado Pago: HMAC-SHA256 no header x-signature, validado com a
   *       assinatura secreta do painel do MP (o MP não envia token custom).
   *       Além disso, todo ping do MP é reverificado na API deles antes de
   *       dar baixa (verifyMercadoPagoPayment), então uma notificação
   *       forjada nunca marca fatura como paga;
   *  3. respostas 200 para eventos não mapeados evitam tempestade de retries
   *     do gateway sem revelar nada sobre a base.
   */
  router.post(
    '/payments/:userId',
    asyncHandler(async (req, res) => {
      
      console.log('➡️ WEBHOOK DE PAGAMENTO RECEBIDO:', req.body);

      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) {
        console.log('⚠️ Webhook barrado: userId da URL não é um UUID válido:', req.params.userId);
        res.status(401).json({ error: 'Não autorizado' });
        return;
      }
      const { userId } = parsed.data;

      const settings = await findSettingsByUserId(userId);
      if (!settings?.webhook_secret_enc) {
        console.log('⚠️ Webhook barrado: usuário sem settings/webhook secret:', userId);
        res.status(401).json({ error: 'Não autorizado' });
        return;
      }

      const xSignature = req.get('x-signature');
      const provided =
        (req.get('asaas-access-token') ||
          req.get('x-webhook-token') ||
          (typeof req.query.token === 'string' ? req.query.token : '')) ?? '';

      if (xSignature && !provided) {
        // Mercado Pago: não há campo de token no painel deles — a autenticidade
        // vem da assinatura HMAC do próprio MP.
        if (!settings.mp_webhook_secret_enc) {
          console.log(
            '⚠️ Webhook barrado: veio x-signature (Mercado Pago), mas a assinatura secreta do MP não está salva nas Configurações'
          );
          res.status(401).json({ error: 'Assinatura do Mercado Pago não configurada' });
          return;
        }
        const body = req.body as Record<string, any> | null;
        const dataId =
          typeof req.query['data.id'] === 'string'
            ? req.query['data.id']
            : body?.data?.id != null
              ? String(body.data.id)
              : undefined;
        const valid = verifyMercadoPagoSignature({
          xSignature,
          xRequestId: req.get('x-request-id'),
          dataId,
          secret: decrypt(settings.mp_webhook_secret_enc)
        });
        if (!valid) {
          console.log('⚠️ Webhook barrado: x-signature do Mercado Pago não confere');
          res.status(401).json({ error: 'Assinatura do webhook inválida' });
          return;
        }
      } else {
        const secret = decrypt(settings.webhook_secret_enc);
        if (!provided || !safeEqual(provided, secret)) {
          console.log(
            provided
              ? '⚠️ Webhook barrado: token do webhook não confere com o das Configurações'
              : '⚠️ Webhook barrado: nenhum token enviado (header asaas-access-token / x-webhook-token ou ?token=)'
          );
          res.status(401).json({ error: 'Token do webhook inválido' });
          return;
        }
      }

      let event = normalizePaymentEvent(req.body);

      if (event.kind === 'mp_check') {
        if (!settings.gateway_api_key_enc) {
          console.log('⚠️ Webhook barrado: ping do Mercado Pago, mas gateway sem API key configurada');
          res.json({ received: true, handled: false, reason: 'gateway não configurado' });
          return;
        }
        event = await verifyMercadoPagoPayment(
          event.paymentId,
          decrypt(settings.gateway_api_key_enc)
        );
      }

      if (event.kind !== 'paid') {
        console.log('⚠️ Webhook barrado: evento ignorado (não é PAYMENT_RECEIVED/PAYMENT_CONFIRMED nem pagamento aprovado)');
        res.json({ received: true, handled: false });
        return;
      }

      const charge = await findChargeForWebhook(
        userId,
        event.gatewayChargeId,
        event.externalReference
      );
      if (!charge) {
        console.log(
          '⚠️ Webhook barrado: nenhuma fatura casa com gatewayChargeId=',
          event.gatewayChargeId,
          'externalReference=',
          event.externalReference
        );
        res.json({ received: true, matched: false });
        return;
      }
      if (charge.status === 'PAID') {
        console.log('⚠️ Webhook barrado: fatura', charge.id, 'já estava PAGA');
        res.json({ received: true, alreadyPaid: true });
        return;
      }

      await markChargePaid(userId, charge.id, {
        netAmountCents: event.netAmountCents,
        gatewayChargeId: event.gatewayChargeId
      });

      // Dashboard aberto atualiza na hora (SSE).
      publish(userId, {
        type: 'payment',
        chargeId: charge.id,
        source: 'webhook'
      });

      // Confirmação no WhatsApp: falha aqui NÃO derruba o webhook — a fatura
      // já está PAGA e o resultado do envio fica em notification_logs.
      try {
        await sendPaymentConfirmation(deps, userId, charge.id);
      } catch (error) {
        console.error('[webhook] confirmação WhatsApp falhou:', error);
      }

      console.log('✅ Webhook processado: fatura', charge.id, 'marcada como PAGA');
      res.json({ received: true, paid: true, chargeId: charge.id });
    })
  );

  return router;
}
