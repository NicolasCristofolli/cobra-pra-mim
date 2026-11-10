import { env } from '../../config/env';
import type { BillingCycle } from './subscription.repo';

/**
 * Gateway da PLATAFORMA: a conta Asaas do Cobra pra mim cobrando os usuários
 * do SaaS. Não confundir com o gateway que cada usuário configura para cobrar
 * os clientes dele (services/gateway).
 */
export interface PlatformCustomerInput {
  userId: string;
  name: string;
  email: string;
  cpfCnpj: string;
}

export interface PlatformSubscriptionInput {
  customerId: string;
  valueCents: number;
  cycle: BillingCycle;
  nextDueDate: string; // YYYY-MM-DD
  description: string;
  externalReference: string;
}

export interface PlatformPayment {
  paymentId: string;
  valueCents: number;
  dueDate: string;
  invoiceUrl: string | null;
}

export interface PlatformBillingPort {
  ensureCustomer(input: PlatformCustomerInput): Promise<string>;
  createSubscription(input: PlatformSubscriptionInput): Promise<string>;
  /** Primeira cobrança gerada pela assinatura (link do checkout). */
  findFirstPayment(subscriptionId: string): Promise<PlatformPayment | null>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export class AsaasPlatformBilling implements PlatformBillingPort {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly successUrl: string | null
  ) {
    this.baseUrl = apiKey.startsWith('$aact_hmlg')
      ? 'https://api-sandbox.asaas.com/v3'
      : 'https://api.asaas.com/v3';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'cobra-pra-mim',
        access_token: this.apiKey,
        ...init?.headers
      },
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Asaas ${response.status} em ${path}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async ensureCustomer(input: PlatformCustomerInput): Promise<string> {
    const body = JSON.stringify({
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
      externalReference: input.userId,
      notificationDisabled: false
    });
    const search = await this.request<{ data: Array<{ id: string }> }>(
      `/customers?externalReference=${encodeURIComponent(input.userId)}&limit=1`
    );
    const existing = search.data[0];
    if (existing) {
      // Atualiza o CPF/CNPJ: o Asaas recusa cobranças de cliente sem documento.
      await this.request(`/customers/${existing.id}`, { method: 'POST', body });
      return existing.id;
    }
    const created = await this.request<{ id: string }>('/customers', { method: 'POST', body });
    return created.id;
  }

  async createSubscription(input: PlatformSubscriptionInput): Promise<string> {
    const created = await this.request<{ id: string }>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: input.customerId,
        // UNDEFINED: o cliente escolhe Pix, boleto ou cartão na página do Asaas.
        billingType: 'UNDEFINED',
        value: Number((input.valueCents / 100).toFixed(2)),
        nextDueDate: input.nextDueDate,
        cycle: input.cycle,
        description: input.description,
        externalReference: input.externalReference,
        // O domínio precisa estar cadastrado no Asaas (Minha Conta > Informações).
        ...(this.successUrl
          ? { callback: { successUrl: this.successUrl, autoRedirect: true } }
          : {})
      })
    });
    return created.id;
  }

  async findFirstPayment(subscriptionId: string): Promise<PlatformPayment | null> {
    const list = await this.request<{
      data: Array<{ id: string; value: number; dueDate: string; invoiceUrl?: string }>;
    }>(`/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=1`);
    const first = list.data[0];
    if (!first) return null;
    return {
      paymentId: first.id,
      valueCents: Math.round(first.value * 100),
      dueDate: first.dueDate,
      invoiceUrl: first.invoiceUrl ?? null
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE'
    });
  }
}

/** null = checkout indisponível (ASAAS_PLATFORM_API_KEY não configurada). */
export function buildPlatformBilling(): PlatformBillingPort | null {
  const key = env.asaasPlatformApiKey;
  if (!key) return null;
  return new AsaasPlatformBilling(key, env.platformCheckoutSuccessUrl);
}
