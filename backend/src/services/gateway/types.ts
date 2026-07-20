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
}
