import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../db';
import { AppError, asyncHandler, notFound } from '../../lib/errors';
import {
  resolveAccess,
  type Access,
  type SubscriptionStatus
} from '../../services/subscription/access';

/**
 * Painel do administrador da plataforma (suporte e acompanhamento).
 *
 * Mostra só dados da CONTA (assinatura, conexão, volume): nunca os clientes
 * finais, valores ou mensagens de quem usa o sistema. Todas as rotas exigem
 * users.role = 'ADMIN', conferido no banco a cada requisição.
 */

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [req.userId])
    .then((user) => {
      // 404 (e não 403): quem não é admin não fica sabendo que a rota existe.
      if (user?.role !== 'ADMIN') return next(notFound());
      next();
    })
    .catch(next);
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
  created_at: Date;
  email_verified: boolean;
  status: SubscriptionStatus | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  plan_name: string | null;
  price_cents: number | null;
  cycle: 'MONTHLY' | 'YEARLY' | null;
  grace_days: number | null;
  whatsapp_configured: boolean;
  whatsapp_disconnected_at: Date | null;
  gateway_provider: string | null;
  gateway_configured: boolean;
  clients: string;
  charges: string;
  failed_24h: string;
  last_sent_at: Date | null;
}

const ACCOUNTS_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.created_at,
         u.email_verified_at IS NOT NULL AS email_verified,
         s.status, s.trial_ends_at, s.current_period_end,
         p.name AS plan_name, p.price_cents, p.cycle, p.grace_days,
         COALESCE(st.whatsapp_provider IS NOT NULL, FALSE) AS whatsapp_configured,
         st.whatsapp_disconnected_at,
         st.gateway_provider,
         COALESCE(st.gateway_api_key_enc IS NOT NULL, FALSE) AS gateway_configured,
         (SELECT COUNT(*) FROM clients c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS clients,
         (SELECT COUNT(*) FROM charges ch WHERE ch.user_id = u.id) AS charges,
         (SELECT COUNT(*) FROM notification_logs n
           WHERE n.user_id = u.id AND NOT n.success
             AND n.created_at > now() - interval '24 hours') AS failed_24h,
         (SELECT MAX(n.created_at) FROM notification_logs n
           WHERE n.user_id = u.id AND n.success) AS last_sent_at
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN plans p ON p.id = s.plan_id
    LEFT JOIN settings st ON st.user_id = u.id`;

/** Teto de contas carregadas no painel (bem acima do volume esperado). */
const MAX_ACCOUNTS = 2000;
const DAY_MS = 86_400_000;

function accessOf(row: AccountRow, now: Date): Access {
  const sub =
    row.status != null
      ? {
          status: row.status,
          current_period_end: row.current_period_end,
          trial_ends_at: row.trial_ends_at,
          grace_days: row.grace_days ?? 0
        }
      : null;
  return resolveAccess(sub, now, { admin: row.role === 'ADMIN' });
}

function serializeAccount(row: AccountRow, now: Date) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    emailVerified: row.email_verified,
    access: accessOf(row, now),
    subscriptionStatus: row.status,
    planName: row.plan_name,
    trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    whatsappConfigured: row.whatsapp_configured,
    whatsappDisconnected: row.whatsapp_disconnected_at !== null,
    gatewayProvider: row.gateway_configured ? row.gateway_provider : null,
    clients: Number(row.clients),
    charges: Number(row.charges),
    failedSends24h: Number(row.failed_24h),
    lastSentAt: row.last_sent_at?.toISOString() ?? null
  };
}

const idParam = z.object({ id: z.string().uuid() });
const extendSchema = z.object({ days: z.number().int().min(1).max(30) });

export default function adminRouter(): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get(
    '/overview',
    asyncHandler(async (_req, res) => {
      const now = new Date();
      const rows = await query<AccountRow>(
        `${ACCOUNTS_SQL} ORDER BY u.created_at DESC LIMIT ${MAX_ACCOUNTS}`
      );
      const accounts = rows.map((row) => serializeAccount(row, now));
      const customers = accounts.filter((account) => account.role === 'USER');

      // Receita recorrente mensal: assinaturas pagas e com acesso liberado.
      const mrrCents = Math.round(
        rows.reduce((sum, row) => {
          if (row.role !== 'USER' || row.price_cents == null) return sum;
          if (row.status !== 'ACTIVE' && row.status !== 'PAST_DUE') return sum;
          if (accessOf(row, now).state === 'BLOCKED') return sum;
          return sum + (row.cycle === 'YEARLY' ? row.price_cents / 12 : row.price_cents);
        }, 0)
      );

      const trialEndingSoon = customers.filter(
        (account) =>
          account.access.reason === 'TRIAL' &&
          account.trialEndsAt !== null &&
          new Date(account.trialEndsAt).getTime() - now.getTime() <= 3 * DAY_MS
      ).length;

      const engineRuns = await query<{
        ran_on: string;
        ok: boolean;
        finished_at: Date;
        report: Record<string, unknown> | null;
        error: string | null;
      }>(
        // Só as execuções que fizeram algo (ou falharam): o ciclo roda de hora
        // em hora e a maioria não tem nada para enviar.
        `SELECT ran_on, ok, finished_at, report, error FROM engine_runs
          WHERE NOT ok
             OR COALESCE((report->>'notified')::int, 0) > 0
             OR COALESCE((report->>'notifyFailed')::int, 0) > 0
             OR COALESCE((report->>'generated')::int, 0) > 0
          ORDER BY finished_at DESC LIMIT 10`
      );
      const lastRun = await queryOne<{ finished_at: Date; ok: boolean }>(
        'SELECT finished_at, ok FROM engine_runs ORDER BY finished_at DESC LIMIT 1'
      );

      res.json({
        summary: {
          accounts: customers.length,
          paying: customers.filter((account) => account.access.reason === 'OK').length,
          trial: customers.filter((account) => account.access.reason === 'TRIAL').length,
          pastDue: customers.filter((account) => account.access.reason === 'PAST_DUE').length,
          blocked: customers.filter((account) => account.access.state === 'BLOCKED').length,
          unverified: customers.filter((account) => !account.emailVerified).length,
          trialEndingSoon,
          whatsappDisconnected: customers.filter((account) => account.whatsappDisconnected).length,
          failedSends24h: customers.reduce((sum, account) => sum + account.failedSends24h, 0),
          mrrCents
        },
        engine: {
          lastRunAt: lastRun?.finished_at.toISOString() ?? null,
          lastRunOk: lastRun?.ok ?? null,
          recent: engineRuns.map((run) => ({
            ranOn: run.ran_on,
            ok: run.ok,
            finishedAt: run.finished_at.toISOString(),
            notified: Number(run.report?.notified ?? 0),
            notifyFailed: Number(run.report?.notifyFailed ?? 0),
            generated: Number(run.report?.generated ?? 0),
            error: run.error ? run.error.split('\n')[0]!.slice(0, 200) : null
          }))
        },
        accounts
      });
    })
  );

  /**
   * Estende o teste grátis de uma conta (suporte: a pessoa pediu mais uns
   * dias para terminar de configurar). Só vale para contas em teste ou sem
   * assinatura; conta que já paga não é alterada por aqui.
   */
  router.post(
    '/accounts/:id/extend-trial',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { days } = extendSchema.parse(req.body);

      const target = await queryOne<{ role: string; status: SubscriptionStatus | null }>(
        `SELECT u.role, s.status FROM users u
           LEFT JOIN subscriptions s ON s.user_id = u.id
          WHERE u.id = $1`,
        [id]
      );
      if (!target) throw notFound('Conta não encontrada');
      if (target.role === 'ADMIN') {
        throw new AppError('Contas de administrador não têm período de teste', 409);
      }
      if (target.status !== null && target.status !== 'TRIALING') {
        throw new AppError(
          'Só é possível estender o teste de contas em período de teste (ou sem assinatura)',
          409,
          'NOT_IN_TRIAL'
        );
      }

      // A partir de agora se o teste já venceu, ou do fim atual se ainda vale.
      const updated =
        target.status === 'TRIALING'
          ? await queryOne<{ trial_ends_at: Date }>(
              `UPDATE subscriptions
                  SET trial_ends_at = GREATEST(now(), COALESCE(trial_ends_at, now()))
                                      + ($2 * interval '1 day'),
                      updated_at = now()
                WHERE user_id = $1 AND status = 'TRIALING'
                RETURNING trial_ends_at`,
              [id, days]
            )
          : await queryOne<{ trial_ends_at: Date }>(
              `INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
               SELECT $1, p.id, 'TRIALING', now() + ($2 * interval '1 day')
                 FROM plans p WHERE p.active
                ORDER BY p.sort_order, p.price_cents LIMIT 1
               ON CONFLICT (user_id) DO NOTHING
               RETURNING trial_ends_at`,
              [id, days]
            );
      if (!updated) {
        throw new AppError('Não foi possível estender o teste desta conta. Atualize a página.', 409);
      }
      console.log(`[admin] ${req.userId} estendeu o teste de ${id} em ${days} dia(s)`);
      res.json({ trialEndsAt: updated.trial_ends_at.toISOString() });
    })
  );

  return router;
}
