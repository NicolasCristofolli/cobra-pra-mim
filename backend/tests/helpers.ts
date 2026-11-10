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
  CreatePixChargeResult
} from '../src/services/gateway';

export async function truncateAll(): Promise<void> {
  await query(
    'TRUNCATE notification_logs, charges, settings, clients, platform_webhook_events, users CASCADE'
  );
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
  } = {}
): Promise<TestUser> {
  const email = options.email ?? `user-${randomUUID().slice(0, 8)}@test.dev`;
  const password = 'senha-super-8';
  const webhookSecret = options.webhookSecret ?? `whsec_${randomUUID().slice(0, 12)}`;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Usuário Teste', email, await bcrypt.hash(password, 4)]
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
  /** Faz o próximo sendText falhar uma vez (simula instabilidade). */
  failNextSend: () => void;
}

export function buildTestApp(
  overrides: { withGateway?: boolean; withWhatsApp?: boolean; withPlatformBilling?: boolean } = {}
): TestHarness {
  const platformCalls: PlatformCall[] = [];
  const sentEmails: MailMessage[] = [];
  let platformCounter = 0;
  const sentMessages: SentMessage[] = [];
  const gatewayCalls: CreatePixChargeInput[] = [];
  let failOnce = false;
  let pixCounter = 0;

  const deps: AppDeps = {
    mailer: {
      async send(message) {
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
            async createPixCharge(
              input: CreatePixChargeInput
            ): Promise<CreatePixChargeResult> {
              gatewayCalls.push(input);
              pixCounter++;
              return {
                gatewayChargeId: `fake_pay_${pixCounter}`,
                pixCopyPaste: `00020126FAKEPIX${pixCounter}5204000053039865802BR`,
                pixQrCodeUrl: null,
                invoiceUrl: `https://fake.gateway/inv/${pixCounter}`
              };
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
    failNextSend: () => {
      failOnce = true;
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
