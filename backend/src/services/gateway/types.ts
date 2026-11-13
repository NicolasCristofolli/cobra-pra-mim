export interface GatewayClient {
  id: string;               // UUID interno — vira externalReference do customer
  name: string;
  phone: string;            // dígitos com DDI
  email?: string | null;
  document?: string | null; // CPF/CNPJ
}

/**
 * Forma de pagamento da fatura no gateway:
 *  - PIX: Pix dinâmico (padrão);
 *  - BOLETO: boleto bancário;
 *  - UNDEFINED: o cliente escolhe na página do gateway (Pix, boleto ou cartão).
 */
export type BillingType = 'PIX' | 'BOLETO' | 'UNDEFINED';

export interface CreatePixChargeInput {
  /** Ausente = PIX. Gateways que só fazem Pix ignoram. */
  billingType?: BillingType;
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
  /** true = o Pix deixa de ser pagável depois do dia do vencimento (Mercado Pago). */
  readonly pixExpiresOnDueDate?: boolean;
  /** true = aceita boleto e "cliente escolhe" além de Pix (Asaas). */
  readonly supportsBoletoAndCard?: boolean;
  createPixCharge(input: CreatePixChargeInput): Promise<CreatePixChargeResult>;
  /**
   * Cancela uma cobrança ainda não paga no gateway (ex.: a fatura foi editada
   * e o Pix antigo, com o valor antigo, não pode mais ser pago).
   */
  cancelCharge(gatewayChargeId: string): Promise<void>;
  /**
   * Cadastra (ou atualiza) no gateway o webhook de pagamento do sistema, para
   * o usuário não precisar colar URL e token à mão. Opcional: só os gateways
   * que oferecem isso por API implementam.
   */
  registerWebhook?(input: RegisterWebhookInput): Promise<void>;
}

export interface RegisterWebhookInput {
  url: string;
  authToken: string;
  /** E-mail que o gateway avisa se a fila do webhook travar. */
  email: string;
}

/** Limite de espera das chamadas aos gateways: sem isso uma conexão pendurada segura o motor. */
export const GATEWAY_TIMEOUT_MS = 15_000;
