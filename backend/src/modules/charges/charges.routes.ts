import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../db';
import { asyncHandler, AppError, notFound } from '../../lib/errors';
import { parseISODate, todayISO } from '../../lib/dates';
import { publish } from '../../lib/events';
import { notifyChargeNow, sendPaymentConfirmation } from '../../services/billing-engine';
import type { AppDeps } from '../../services/deps';
import { findSettingsByUserId } from '../settings/settings.routes';
import {
  cancelCharge,
  createCharge,
  deleteCharge,
  findChargeById,
  listCharges,
  markChargePaid,
  reactivateCharge,
  unmarkChargePaid,
  serializeCharge,
  updateCharge,
  type ChargeStatus
} from './charges.repo';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Formato YYYY-MM-DD E data que existe no calendário (31/02 é recusado com 400, não 500). */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

const isoDate = (message: string) => z.string().refine(isRealDate, message);

// Teto de R$ 9.999.999,99: bem abaixo do limite do INTEGER do Postgres.
const MAX_AMOUNT_CENTS = 999_999_999;
const amountCents = z
  .number()
  .int()
  .positive('Valor precisa ser maior que zero')
  .max(MAX_AMOUNT_CENTS, 'Valor acima do limite permitido');

const createSchema = z
  .object({
    clientId: z.string().uuid('Selecione um cliente'),
    description: z.string().trim().min(2, 'Descreva a cobrança'),
    amountCents,
    dueDate: isoDate('Data de vencimento inválida'),
    recurrence: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY']).default('NONE'),
    recurrenceEndDate: isoDate('Data limite da recorrência inválida').nullish()
  })
  .superRefine((data, ctx) => {
    if (data.dueDate < todayISO()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'A data de vencimento não pode ser retroativa'
      });
    }
    // Semanal/mensal exigem data limite; anual pode rodar sem limite.
    if (
      (data.recurrence === 'WEEKLY' || data.recurrence === 'MONTHLY') &&
      !data.recurrenceEndDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceEndDate'],
        message: 'Informe até quando a recorrência deve rodar'
      });
    }
    if (data.recurrenceEndDate && data.recurrenceEndDate < data.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceEndDate'],
        message: 'A data limite precisa ser igual ou posterior ao primeiro vencimento'
      });
    }
  });

const updateSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a cobrança'),
  amountCents,
  dueDate: isoDate('Data de vencimento inválida')
});

const listSchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['PENDING', 'SENT', 'PAID', 'OVERDUE', 'CANCELED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

const idParam = z.object({ id: z.string().uuid() });

export default function chargesRouter(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = listSchema.parse(req.query);
      const { items, total } = await listCharges({
        userId: req.userId,
        clientName: filters.q || undefined,
        status: filters.status as ChargeStatus | undefined,
        page: filters.page,
        pageSize: filters.pageSize
      });
      res.json({
        items: items.map(serializeCharge),
        total,
        page: filters.page,
        pageSize: filters.pageSize
      });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = createSchema.parse(req.body);

      // O cliente precisa existir E pertencer ao tenant logado — impede que
      // um usuário crie cobranças "em nome" de clientes de outra conta.
      // deleted_at IS NULL: cliente excluído (soft delete) não recebe cobrança
      // nova — é preciso restaurá-lo primeiro (botão "Desfazer").
      const client = await queryOne<{ id: string }>(
        'SELECT id FROM clients WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL',
        [req.userId, data.clientId]
      );
      if (!client) throw notFound('Cliente não encontrado');

      const charge = await createCharge({
        userId: req.userId,
        clientId: data.clientId,
        description: data.description,
        amountCents: data.amountCents,
        dueDate: data.dueDate,
        recurrence: data.recurrence,
        recurrenceEndDate: data.recurrenceEndDate ?? null
      });
      res.status(201).json(serializeCharge(charge));
    })
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = updateSchema.parse(req.body);

      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status !== 'PENDING' && existing.status !== 'SENT') {
        throw new AppError('Só é possível editar cobranças em aberto', 409);
      }

      // Valor ou vencimento mudou e já existe Pix no gateway: cancela a
      // cobrança antiga lá, senão o cliente ainda conseguiria pagar o valor
      // antigo e o webhook daria baixa na fatura com o valor novo. Falha aqui
      // não impede a edição (o Pix antigo deixa de ser enviado de todo modo).
      const pixOutdated =
        existing.amount_cents !== data.amountCents || existing.due_date !== data.dueDate;
      if (pixOutdated && existing.gateway_charge_id) {
        try {
          const settings = await findSettingsByUserId(req.userId);
          const gateway = settings ? deps.gatewayFactory(settings) : null;
          await gateway?.cancelCharge(existing.gateway_charge_id);
        } catch (error) {
          console.warn('[charges] não foi possível cancelar o Pix antigo no gateway:', error);
        }
      }

      let updated;
      try {
        updated = await updateCharge(req.userId, id, {
          description: data.description,
          amountCents: data.amountCents,
          dueDate: data.dueDate
        });
      } catch (error) {
        // UNIQUE(series_id, due_date): outro ciclo da série já ocupa a data.
        if ((error as { code?: string }).code === '23505') {
          throw new AppError('Já existe uma fatura desta série com esse vencimento', 409);
        }
        throw error;
      }
      // Entre o find e o update a fatura pode ter deixado de estar em aberto.
      if (!updated) throw new AppError('Só é possível editar cobranças em aberto', 409);

      res.json(
        serializeCharge({
          ...updated,
          client_name: existing.client_name,
          client_phone: existing.client_phone
        })
      );
    })
  );

  router.post(
    '/:id/pay',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status === 'PAID') throw new AppError('Fatura já está paga', 409);
      if (existing.status === 'CANCELED') {
        throw new AppError('Fatura cancelada não pode ser paga', 409);
      }
      const updated = await markChargePaid(req.userId, id);
      // Outra requisição (ou o webhook) deu baixa entre a leitura e o update.
      if (!updated) throw new AppError('Fatura já está paga', 409);
      publish(req.userId, { type: 'payment', chargeId: id, source: 'manual' });

      // Confirmação no WhatsApp: falha aqui NÃO desfaz a baixa — a fatura já
      // está PAGA e o resultado do envio fica em notification_logs.
      try {
        await sendPaymentConfirmation(deps, req.userId, id);
      } catch (error) {
        console.error('[charges] confirmação WhatsApp falhou:', error);
      }

      res.json(serializeCharge({ ...updated, client_name: existing.client_name, client_phone: existing.client_phone }));
    })
  );

  // Botão "Desfazer" do toast exibido logo após marcar como paga manualmente.
  router.post(
    '/:id/unpay',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await unmarkChargePaid(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível desfazer a baixa de faturas pagas', 409);
      }
      publish(req.userId, { type: 'payment', chargeId: id, source: 'manual_undo' });
      res.json(serializeCharge(updated));
    })
  );

  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await cancelCharge(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível cancelar faturas pendentes ou atrasadas', 409);
      }
      res.json(serializeCharge(updated));
    })
  );

  // Botão "Reativar" — desfaz um cancelamento (o próprio ou o automático
  // disparado ao excluir o cliente, via undo do toast).
  router.post(
    '/:id/reactivate',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await reactivateCharge(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível reativar faturas canceladas', 409);
      }
      res.json(serializeCharge(updated));
    })
  );

  // Exclusão DEFINITIVA: só para faturas canceladas ou de cliente excluído.
  // Faturas em aberto/pagas são histórico financeiro e não podem sumir.
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status !== 'CANCELED' && existing.client_id !== null) {
        throw new AppError(
          'Só é possível excluir faturas canceladas ou de clientes excluídos',
          409
        );
      }
      const deleted = await deleteCharge(req.userId, id);
      if (!deleted) throw notFound('Fatura não encontrada');
      res.json({ ok: true });
    })
  );

  // Dispara imediatamente o fluxo do motor para UMA fatura: gera o Pix no
  // gateway (se configurado) e envia a mensagem no WhatsApp.
  router.post(
    '/:id/notify',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const charge = await findChargeById(req.userId, id);
      if (!charge) throw notFound('Fatura não encontrada');
      if (charge.status === 'PAID' || charge.status === 'CANCELED') {
        throw new AppError('Esta fatura não está mais em aberto', 409);
      }
      const result = await notifyChargeNow(deps, req.userId, id);
      if (!result.sent) {
        throw new AppError(result.reason ?? 'Não foi possível enviar a cobrança', 422);
      }
      const refreshed = await findChargeById(req.userId, id);
      res.json({ sent: true, charge: serializeCharge(refreshed!) });
    })
  );

  return router;
}
