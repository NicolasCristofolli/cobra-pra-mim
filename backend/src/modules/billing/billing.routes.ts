import { Router } from 'express';
import { z } from 'zod';
import { queryOne, withTransaction } from '../../db';
import { isValidCpfCnpj } from '../../lib/document';
import { todayISO } from '../../lib/dates';
import { AppError, asyncHandler, notFound } from '../../lib/errors';
import type { AppDeps } from '../../services/deps';
import { resolveAccess } from '../../services/subscription/access';
import {
  findActivePlanByCode,
  findOpenPayment,
  findSubscriptionByUser,
  listActivePlans
} from '../../services/subscription/subscription.repo';
import { serializePayment, serializePlan, serializeSubscription } from './billing.serializers';

const checkoutSchema = z.object({
  planCode: z.string().trim().min(1, 'Escolha um plano'),
  cpfCnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => isValidCpfCnpj(value), 'CPF ou CNPJ inválido')
});

const unavailable = () =>
  new AppError(
    'Pagamento temporariamente indisponível. Tente novamente em alguns minutos.',
    503,
    'CHECKOUT_UNAVAILABLE'
  );

/**
 * Rotas de assinatura. Ficam atrás de requireAuth + loadAccess, mas NÃO de
 * requireActiveSubscription: quem está bloqueado precisa delas para pagar.
 */
export default function billingRouter(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/plans',
    asyncHandler(async (_req, res) => {
      res.json((await listActivePlans()).map(serializePlan));
    })
  );

  // Leve: usado pelo middleware do Next.js a cada navegação.
  router.get('/access', (req, res) => {
    res.json(req.access);
  });

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const sub = await findSubscriptionByUser(req.userId);
      const openPayment = sub ? await findOpenPayment(sub.id) : null;
      res.json({
        access: resolveAccess(sub),
        subscription: serializeSubscription(sub),
        openPayment: serializePayment(openPayment)
      });
    })
  );

  /**
   * Passo 2 do fluxo: cria (ou reaproveita) a assinatura no Asaas e devolve o
   * link de pagamento. A conta só é ativada pelo webhook (passo 3), nunca por
   * esta rota nem pela URL de retorno.
   */
  router.post(
    '/checkout',
    asyncHandler(async (req, res) => {
      const { planCode, cpfCnpj } = checkoutSchema.parse(req.body);
      const platform = deps.platformBillingFactory();
      if (!platform) throw unavailable();

      const plan = await findActivePlanByCode(planCode);
      if (!plan) throw notFound('Plano não encontrado');

      const checkoutUrl = await withTransaction(async (tx) => {
        // Um checkout por usuário por vez: o duplo clique não cria duas assinaturas.
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.userId]);

        const user = (
          await tx.query<{ name: string; email: string }>(
            'SELECT name, email FROM users WHERE id = $1',
            [req.userId]
          )
        ).rows[0]!;
        const sub = await findSubscriptionByUser(req.userId);
        const access = resolveAccess(sub);
        const today = todayISO();
        const openPayment = sub?.gateway_subscription_id ? await findOpenPayment(sub.id) : null;
        const samePlan = sub?.plan_id === plan.id;
        const isPaying = sub?.status === 'ACTIVE' || sub?.status === 'PAST_DUE';

        if (sub && isPaying && access.state !== 'BLOCKED' && !samePlan) {
          throw new AppError(
            'Para trocar de plano, cancele a assinatura atual primeiro.',
            409,
            'SUBSCRIPTION_ALREADY_ACTIVE'
          );
        }

        // Cobrança em aberto da assinatura atual: reaproveita (duplo clique,
        // "Pagar agora" do aviso de atraso, renovação antecipada).
        // findOpenPayment só devolve boletos que, pagos, devolvem o acesso.
        if (openPayment?.checkout_url && samePlan) {
          return openPayment.checkout_url;
        }
        if (sub && isPaying && access.state !== 'BLOCKED') {
          throw new AppError(
            'Sua assinatura já está em dia. A próxima cobrança aparece aqui quando for gerada.',
            409,
            'SUBSCRIPTION_ALREADY_ACTIVE'
          );
        }

        // Assinatura antiga no Asaas (plano trocado, expirada ou cancelada):
        // encerra para o Asaas não continuar gerando boletos dela.
        if (sub?.gateway_subscription_id) {
          try {
            await platform.cancelSubscription(sub.gateway_subscription_id);
          } catch (error) {
            console.warn('[billing] não foi possível cancelar a assinatura antiga:', error);
          }
        }

        // Ainda com acesso (trial ou cancelada dentro do período): a primeira
        // cobrança vence quando o acesso atual acabaria, sem pagar em dobro.
        const accessEnd = access.state === 'FULL' && access.blocksAt ? access.blocksAt.slice(0, 10) : today;
        const nextDueDate = accessEnd > today ? accessEnd : today;

        let customerId: string;
        let gatewaySubscriptionId: string;
        let firstPayment;
        try {
          customerId = await platform.ensureCustomer({
            userId: req.userId,
            name: user.name,
            email: user.email,
            cpfCnpj
          });
          gatewaySubscriptionId = await platform.createSubscription({
            customerId,
            valueCents: plan.price_cents,
            cycle: plan.cycle,
            nextDueDate,
            description: `Cobra pra mim — plano ${plan.name}`,
            externalReference: req.userId
          });
          firstPayment = await platform.findFirstPayment(gatewaySubscriptionId);
        } catch (error) {
          console.error('[billing] falha no checkout do Asaas:', error);
          throw new AppError(
            'Não foi possível iniciar o pagamento. Confira o CPF/CNPJ e tente novamente.',
            502,
            'CHECKOUT_FAILED'
          );
        }

        // Quem ainda tem acesso continua com o status atual até o pagamento.
        const keepStatus = access.state === 'FULL' && sub && (sub.status === 'TRIALING' || sub.status === 'CANCELED');
        const saved = await tx.query<{ id: string }>(
          `INSERT INTO subscriptions (user_id, plan_id, status, gateway_customer_id, gateway_subscription_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE
              SET plan_id = EXCLUDED.plan_id,
                  status = EXCLUDED.status,
                  gateway_customer_id = EXCLUDED.gateway_customer_id,
                  gateway_subscription_id = EXCLUDED.gateway_subscription_id,
                  canceled_at = CASE WHEN EXCLUDED.status = 'CANCELED'
                                     THEN subscriptions.canceled_at END,
                  updated_at = now()
           RETURNING id`,
          [
            req.userId,
            plan.id,
            keepStatus ? sub!.status : 'PENDING_PAYMENT',
            customerId,
            gatewaySubscriptionId
          ]
        );

        if (firstPayment) {
          await tx.query(
            `INSERT INTO subscription_payments
               (subscription_id, gateway_payment_id, amount_cents, due_date, checkout_url)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (gateway_payment_id) DO UPDATE
                SET checkout_url = EXCLUDED.checkout_url, updated_at = now()`,
            [
              saved.rows[0]!.id,
              firstPayment.paymentId,
              firstPayment.valueCents,
              firstPayment.dueDate,
              firstPayment.invoiceUrl
            ]
          );
        }
        // Sem link ainda: o webhook PAYMENT_CREATED preenche, e o front
        // consulta /billing/status até ele aparecer.
        return firstPayment?.invoiceUrl ?? null;
      });

      res.status(201).json({ checkoutUrl });
    })
  );

  router.post(
    '/cancel',
    asyncHandler(async (req, res) => {
      const sub = await findSubscriptionByUser(req.userId);
      if (!sub || sub.status === 'CANCELED' || sub.status === 'EXPIRED') {
        throw new AppError('Não há assinatura ativa para cancelar', 409, 'NO_ACTIVE_SUBSCRIPTION');
      }
      if (sub.gateway_subscription_id) {
        const platform = deps.platformBillingFactory();
        if (!platform) throw unavailable();
        await platform.cancelSubscription(sub.gateway_subscription_id);
      }
      const updated = await queryOne<{ current_period_end: Date | null }>(
        `UPDATE subscriptions
            SET status = 'CANCELED', canceled_at = now(), updated_at = now()
          WHERE id = $1
        RETURNING current_period_end`,
        [sub.id]
      );
      // O acesso continua até o fim do período já pago.
      res.json({ canceled: true, accessUntil: updated?.current_period_end?.toISOString() ?? null });
    })
  );

  return router;
}
