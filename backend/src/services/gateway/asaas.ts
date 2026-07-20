import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  GatewayPort
} from './types';

/**
 * Adapter Asaas (https://docs.asaas.com).
 * Fluxo: garante o customer (deduplicado por externalReference = UUID do
 * cliente), cria o payment PIX e busca o QR Code / copia e cola.
 * Chaves de sandbox começam com "$aact_hmlg_" — a base URL é detectada.
 */
export class AsaasGateway implements GatewayPort {
  readonly provider = 'ASAAS' as const;
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
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Asaas ${response.status} em ${path}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
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

    const payment = await this.request<{ id: string; invoiceUrl?: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        value: Number((input.amountCents / 100).toFixed(2)),
        dueDate: input.dueDate,
        description: input.description,
        externalReference: input.externalReference
      })
    });

    let pixCopyPaste: string | null = null;
    let pixQrCodeUrl: string | null = null;
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
}
