import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { requireAuth } from './middleware/auth';
import { requireSameOrigin } from './middleware/same-origin';
import { loadAccess, requireActiveSubscription } from './middleware/subscription';
import authRouter from './modules/auth/auth.routes';
import billingRouter from './modules/billing/billing.routes';
import platformWebhookRouter from './modules/billing/platform-webhook.routes';
import clientsRoutes from './modules/clients/clients.routes';
import chargesRouter from './modules/charges/charges.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import settingsRoutes from './modules/settings/settings.routes';
import webhooksRouter from './modules/webhooks/webhooks.routes';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes';
import { defaultDeps, type AppDeps } from './services/deps';

/**
 * Fábrica do app Express. Os testes injetam `deps` fake (gateway/WhatsApp)
 * e recebem exatamente o mesmo app que roda em produção.
 */
export function createApp(deps: AppDeps = defaultDeps): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.frontendOrigin, credentials: true }));
  // Payload de auth é pequeno: limite menor ANTES do parser global (o
  // primeiro parser que roda consome o corpo).
  app.use('/auth', express.json({ limit: '10kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'cobra-pra-mim-api' });
  });

  // Webhooks: chamados servidor a servidor pelos gateways (token próprio).
  app.use('/webhooks/platform', platformWebhookRouter());
  app.use('/webhooks', webhooksRouter(deps));

  // Daqui em diante, POST/PUT/PATCH/DELETE com Origin de outro site = 403.
  app.use(requireSameOrigin);

  // Fora do gate de sessão.
  app.use('/auth', authRouter());

  // Assinatura: exige sessão, mas fica liberada para quem está bloqueado
  // (é por aqui que a pessoa escolhe o plano e paga).
  const session = [requireAuth, loadAccess];
  app.use('/billing', session, billingRouter(deps));

  // Rotas de negócio: sessão válida E assinatura que libere acesso (senão 402).
  const paid = [...session, requireActiveSubscription];
  app.use('/clients', paid, clientsRoutes);
  app.use('/charges', paid, chargesRouter(deps));
  app.use('/dashboard', paid, dashboardRoutes);
  app.use('/settings', paid, settingsRoutes);
  app.use('/whatsapp', paid, whatsappRoutes);

  app.use(errorHandler);
  return app;
}
