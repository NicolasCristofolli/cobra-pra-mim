export interface GatewayClient {
  id: string;               // UUID interno — vira externalReference do customer
  name: string;
  phone: string;            // dígitos com DDI
  email?: string | null;
  document?: string | null; // CPF/CNPJ
}

export interface CreatePixChargeInput {
  amountCents: number;
  dueDate: string;          // YYYY-MM-DD
  description: string;
  externalReference: string; // nosso charge.id — volta no webhook
  client: GatewayClient;
}

export interface CreatePixChargeResult {
  gatewayChargeId: string;
  pixCopyPaste: string | null;
  pixQrCodeUrl: string | null;
  invoiceUrl: string | null;
}

export interface GatewayPort {
  readonly provider: 'ASAAS' | 'MERCADO_PAGO';
  createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult>;
  /**
   * Cancela uma cobrança ainda não paga no gateway (ex.: a fatura foi editada
   * e o Pix antigo, com o valor antigo, não pode mais ser pago).
   */
  cancelCharge(gatewayChargeId: string): Promise<void>;
}

/** Limite de espera das chamadas aos gateways: sem isso uma conexão pendurada segura o motor. */
export const GATEWAY_TIMEOUT_MS = 15_000;
