import {
  GATEWAY_TIMEOUT_MS,
  type CreatePixChargeInput,
  type CreatePixChargeResult,
  type GatewayPort,
  type RegisterWebhookInput
} from './types';

/**
 * Adapter Asaas (https://docs.asaas.com).
 * Fluxo: garante o customer (deduplicado por externalReference = UUID do
 * cliente), cria o payment PIX e busca o QR Code / copia e cola.
 * Chaves de sandbox começam com "$aact_hmlg_" — a base URL é detectada.
 */
export class AsaasGateway implements GatewayPort {
  readonly provider = 'ASAAS' as const;
  readonly supportsBoletoAndCard = true;
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string) {
    this.baseUrl = apiKey.startsWith('$aact_hmlg')
      ? 'https://api-sandbox.asaas.com/v3'
      : 'https://api.asaas.com/v3';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        ...init?.headers
      },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Asaas ${response.status} em ${path}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async ensureCustomer(client: CreatePixChargeInput['client']): Promise<string> {
    const search = await this.request<{ data: Array<{ id: string }> }>(
      `/customers?externalReference=${encodeURIComponent(client.id)}&limit=1`
    );
    if (search.data.length > 0) return search.data[0]!.id;

    const created = await this.request<{ id: string }>('/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: client.name,
        mobilePhone: client.phone,
        email: client.email ?? undefined,
        cpfCnpj: client.document ?? undefined,
        externalReference: client.id
      })
    });
    return created.id;
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const customerId = await this.ensureCustomer(input.client);
    const billingType = input.billingType ?? 'PIX';

    const payment = await this.request<{ id: string; invoiceUrl?: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        billingType,
        value: Number((input.amountCents / 100).toFixed(2)),
        dueDate: input.dueDate,
        description: input.description,
        externalReference: input.externalReference
      })
    });

    let pixCopyPaste: string | null = null;
    let pixQrCodeUrl: string | null = null;
    // Boleto / "cliente escolhe": não há copia-e-cola; o pagamento é pelo
    // link da fatura do Asaas (invoiceUrl).
    if (billingType !== 'PIX') {
      return {
        gatewayChargeId: payment.id,
        pixCopyPaste,
        pixQrCodeUrl,
        invoiceUrl: payment.invoiceUrl ?? null
      };
    }
    try {
      const qr = await this.request<{ payload?: string; encodedImage?: string }>(
        `/payments/${payment.id}/pixQrCode`
      );
      pixCopyPaste = qr.payload ?? null;
      pixQrCodeUrl = qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null;
    } catch (error) {
      // A cobrança existe; sem o QR ainda dá para enviar o invoiceUrl.
      console.warn('[asaas] cobrança criada mas QR indisponível:', error);
    }

    return {
      gatewayChargeId: payment.id,
      pixCopyPaste,
      pixQrCodeUrl,
      invoiceUrl: payment.invoiceUrl ?? null
    };
  }

  async cancelCharge(gatewayChargeId: string): Promise<void> {
    await this.request(`/payments/${encodeURIComponent(gatewayChargeId)}`, { method: 'DELETE' });
  }

  /**
   * Webhook de pagamento via API (POST/PUT /v3/webhooks). Se já existir um
   * webhook apontando para a mesma URL, ele é atualizado (token novo,
   * reativado) em vez de duplicado.
   */
  async registerWebhook(input: RegisterWebhookInput): Promise<void> {
    const body = JSON.stringify({
      name: 'Cobra pra mim',
      url: input.url,
      email: input.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: input.authToken,
      sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']
    });
    const list = await this.request<{ data?: Array<{ id: string; url?: string }> }>(
      '/webhooks?limit=100'
    );
    const existing = list.data?.find((hook) => hook.url === input.url);
    if (existing) {
      await this.request(`/webhooks/${encodeURIComponent(existing.id)}`, { method: 'PUT', body });
    } else {
      await this.request('/webhooks', { method: 'POST', body });
    }
  }
}
