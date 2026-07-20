import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { requireAuth } from './middleware/auth';
import authRoutes from './modules/auth/auth.routes';
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
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'cobra-pra-mim-api' });
  });

  // Fora do gate de sessão: auth e webhooks (chamados pelos gateways).
  app.use('/auth', authRoutes);
  app.use('/webhooks', webhooksRouter(deps));

  // Rotas de negócio: exigem sessão válida.
  const gate = [requireAuth];
  app.use('/clients', gate, clientsRoutes);
  app.use('/charges', gate, chargesRouter(deps));
  app.use('/dashboard', gate, dashboardRoutes);
  app.use('/settings', gate, settingsRoutes);
  app.use('/whatsapp', gate, whatsappRoutes);

  app.use(errorHandler);
  return app;
}
