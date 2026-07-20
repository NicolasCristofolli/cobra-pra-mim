import type {
  CreatePixChargeInput,
  CreatePixChargeResult,
  GatewayPort
} from './types';

/**
 * Adapter Mercado Pago (https://www.mercadopago.com.br/developers).
 * Cria um pagamento PIX direto; o copia-e-cola e o QR vêm em
 * point_of_interaction.transaction_data.
 */
export class MercadoPagoGateway implements GatewayPort {
  readonly provider = 'MERCADO_PAGO' as const;
  private readonly baseUrl = 'https://api.mercadopago.com';

  constructor(private readonly accessToken: string) {}

  async createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult> {
    const [firstName, ...rest] = input.client.name.split(' ');
    const response = await fetch(`${this.baseUrl}/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        // Idempotência: repetir a criação para a MESMA fatura não duplica.
        'X-Idempotency-Key': input.externalReference
      },
      body: JSON.stringify({
        transaction_amount: Number((input.amountCents / 100).toFixed(2)),
        payment_method_id: 'pix',
        description: input.description,
        external_reference: input.externalReference,
        // Pix expira no fim do dia do vencimento (Brasil aboliu o horário
        // de verão; -03:00 é fixo para America/Sao_Paulo).
        date_of_expiration: `${input.dueDate}T23:59:59.000-03:00`,
        payer: {
          // O MP exige e-mail do pagador; sem e-mail cadastrado usamos um
          // endereço sintético e único por cliente.
          email:
            input.client.email ??
            `pagador+${input.client.id.slice(0, 8)}@cobrapramim.com.br`,
          first_name: firstName,
          last_name: rest.join(' ') || undefined,
          identification: input.client.document
            ? {
                type: input.client.document.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF',
                number: input.client.document.replace(/\D/g, '')
              }
            : undefined
        }
      })
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Mercado Pago ${response.status}: ${text.slice(0, 300)}`);
    }
    const payment = JSON.parse(text) as {
      id: number;
      point_of_interaction?: {
        transaction_data?: {
          qr_code?: string;
          qr_code_base64?: string;
          ticket_url?: string;
        };
      };
    };

    const data = payment.point_of_interaction?.transaction_data;
    return {
      gatewayChargeId: String(payment.id),
      pixCopyPaste: data?.qr_code ?? null,
      pixQrCodeUrl: data?.qr_code_base64
        ? `data:image/png;base64,${data.qr_code_base64}`
        : null,
      invoiceUrl: data?.ticket_url ?? null
    };
  }
}
