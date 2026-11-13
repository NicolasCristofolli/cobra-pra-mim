import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { query, queryOne } from '../src/db';
import { encrypt } from '../src/lib/crypto';
import {
  DEFAULT_CHARGE_TEMPLATE,
  DEFAULT_PAID_TEMPLATE
} from '../src/lib/template';
import type { AppDeps } from '../src/services/deps';
import type { MailMessage } from '../src/services/mailer';
import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  RegisterWebhookInput
} from '../src/services/gateway';

export async function truncateAll(): Promise<void> {
  // E-mails (confirmação, redefinição) são gerados depois da resposta HTTP e
  // podem ainda estar gravando o token quando o próximo teste limpa o banco.
  for (let attempt = 1; ; attempt++) {
    try {
      await query(
        'TRUNCATE notification_logs, charges, settings, clients, platform_webhook_events, users CASCADE'
      );
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '40P01' || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  webhookSecret: string;
}

export type TestSubscription = 'ACTIVE' | 'NONE';

export async function createUser(
  options: {
    email?: string;
    withSettings?: boolean;
    webhookSecret?: string;
    /** Padrão ACTIVE: os testes de negócio não querem esbarrar no 402. */
    subscription?: TestSubscription;
    /** Padrão true: só os testes de confirmação querem e-mail pendente. */
    emailVerified?: boolean;
  } = {}
): Promise<TestUser> {
  const email = options.email ?? `user-${randomUUID().slice(0, 8)}@test.dev`;
  const password = 'senha-super-8';
  const webhookSecret = options.webhookSecret ?? `whsec_${randomUUID().slice(0, 12)}`;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, email_verified_at)
     VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END) RETURNING id`,
    ['Usuário Teste', email, await bcrypt.hash(password, 4), options.emailVerified !== false]
  );
  const id = row!.id;

  if ((options.subscription ?? 'ACTIVE') === 'ACTIVE') {
    await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, gateway_subscription_id)
       VALUES ($1, (SELECT id FROM plans WHERE code = 'mensal'), 'ACTIVE',
               now() + interval '30 days', $2)`,
      [id, `sub_test_${id.slice(0, 8)}`]
    );
  }

  if (options.withSettings !== false) {
    await query(
      `INSERT INTO settings (user_id, webhook_secret_enc, message_template, paid_template)
       VALUES ($1, $2, $3, $4)`,
      [id, encrypt(webhookSecret), DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE]
    );
  }
  return { id, email, password, webhookSecret };
}

export async function createClient(
  userId: string,
  data: { name: string; phone: string; email?: string | null }
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO clients (user_id, name, phone, email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, data.name, data.phone, data.email ?? null]
  );
  return row!.id;
}

// ---------------- Fakes de I/O externo ----------------

export interface SentMessage {
  phone: string;
  message: string;
}

export interface PlatformCall {
  method: string;
  args: unknown;
}

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  deps: AppDeps;
  /** E-mails "enviados" (recuperação de senha). */
  sentEmails: MailMessage[];
  /** Chamadas ao Asaas da plataforma (checkout), em ordem. */
  platformCalls: PlatformCall[];
  sentMessages: SentMessage[];
  gatewayCalls: CreatePixChargeInput[];
  gatewayCancels: string[];
  /** Faz o próximo sendText falhar uma vez (simula instabilidade). */
  failNextSend: () => void;
  /** Faz o próximo e-mail falhar uma vez (simula SMTP fora do ar). */
  failNextEmail: () => void;
  /** Webhooks cadastrados no gateway fake (registro automático). */
  webhookRegistrations: RegisterWebhookInput[];
  /** Simula o chip conectado/desconectado (padrão: conectado). */
  setWhatsappConnected: (connected: boolean) => void;
}

export function buildTestApp(
  overrides: { withGateway?: boolean; withWhatsApp?: boolean; withPlatformBilling?: boolean } = {}
): TestHarness {
  const platformCalls: PlatformCall[] = [];
  const sentEmails: MailMessage[] = [];
  let platformCounter = 0;
  const sentMessages: SentMessage[] = [];
  const gatewayCalls: CreatePixChargeInput[] = [];
  const gatewayCancels: string[] = [];
  const webhookRegistrations: RegisterWebhookInput[] = [];
  let whatsappConnected = true;
  let failOnce = false;
  let failEmailOnce = false;
  let pixCounter = 0;

  const deps: AppDeps = {
    mailer: {
      async send(message) {
        if (failEmailOnce) {
          failEmailOnce = false;
          throw new Error('SMTP fora do ar (simulado)');
        }
        sentEmails.push(message);
      }
    },
    platformBillingFactory: () =>
      overrides.withPlatformBilling === false
        ? null
        : {
            async ensureCustomer(input) {
              platformCalls.push({ method: 'ensureCustomer', args: input });
              return 'cus_fake';
            },
            async createSubscription(input) {
              platformCalls.push({ method: 'createSubscription', args: input });
              platformCounter++;
              return `sub_fake_${platformCounter}`;
            },
            async findFirstPayment(subscriptionId) {
              platformCalls.push({ method: 'findFirstPayment', args: subscriptionId });
              return {
                paymentId: `pay_${subscriptionId}`,
                valueCents: 4990,
                dueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
                invoiceUrl: `https://fake.asaas/i/${subscriptionId}`
              };
            },
            async cancelSubscription(subscriptionId) {
              platformCalls.push({ method: 'cancelSubscription', args: subscriptionId });
            }
          },
    gatewayFactory: () =>
      overrides.withGateway === false
        ? null
        : {
            provider: 'ASAAS',
            supportsBoletoAndCard: true,
            async createPixCharge(
              input: CreatePixChargeInput
            ): Promise<CreatePixChargeResult> {
              gatewayCalls.push(input);
              pixCounter++;
              return {
                gatewayChargeId: `fake_pay_${pixCounter}`,
                // Como no Asaas: boleto / "cliente escolhe" não têm copia e cola.
                pixCopyPaste:
                  (input.billingType ?? 'PIX') === 'PIX'
                    ? `00020126FAKEPIX${pixCounter}5204000053039865802BR`
                    : null,
                pixQrCodeUrl: null,
                invoiceUrl: `https://fake.gateway/inv/${pixCounter}`
              };
            },
            async cancelCharge(gatewayChargeId: string): Promise<void> {
              gatewayCancels.push(gatewayChargeId);
            },
            async registerWebhook(input: RegisterWebhookInput): Promise<void> {
              webhookRegistrations.push(input);
            }
          },
    whatsappFactory: () =>
      overrides.withWhatsApp === false
        ? null
        : {
            provider: 'EVOLUTION',
            async sendText(phone: string, message: string): Promise<void> {
              if (failOnce) {
                failOnce = false;
                throw new Error('instabilidade simulada no provedor');
              }
              sentMessages.push({ phone, message });
            },
            async isConnected(): Promise<boolean> {
              return whatsappConnected;
            }
          }
  };

  return {
    app: createApp(deps),
    deps,
    sentEmails,
    platformCalls,
    sentMessages,
    gatewayCalls,
    gatewayCancels,
    webhookRegistrations,
    setWhatsappConnected: (connected: boolean) => {
      whatsappConnected = connected;
    },
    failNextSend: () => {
      failOnce = true;
    },
    failNextEmail: () => {
      failEmailOnce = true;
    }
  };
}

/** Registra + loga um usuário via HTTP e devolve um agent com o cookie. */
export async function loginAgent(app: TestHarness['app'], user: TestUser) {
  const agent = request.agent(app);
  const response = await agent
    .post('/auth/login')
    .send({ email: user.email, password: user.password });
  if (response.status !== 200) {
    throw new Error(`login falhou no helper: ${response.status} ${response.text}`);
  }
  return agent;
}
