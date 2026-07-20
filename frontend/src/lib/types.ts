// Espelho dos serializers do backend — a única fonte de verdade de shape.

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface User {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string;
}

export type ClientStatus = 'ADIMPLENTE' | 'INADIMPLENTE' | 'SEM_COBRANCAS';

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  document: string | null;
  notes: string | null;
  status: ClientStatus;
  openCharges: number;
  overdueCharges: number;
  paidCharges: number;
  createdAt: string;
}

// SENT = mensagem de cobrança já enviada no WhatsApp, aguardando pagamento.
export type ChargeStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELED';
export type Recurrence = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Charge {
  id: string;
  // null quando o cliente foi excluído (a fatura permanece como histórico)
  clientId: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  description: string;
  amountCents: number;
  netAmountCents: number | null;
  dueDate: string;
  status: ChargeStatus;
  recurrence: Recurrence;
  /** Último vencimento que a série recorrente pode gerar (null = sem limite). */
  recurrenceEndDate: string | null;
  seriesId: string;
  pixCopyPaste: string | null;
  pixQrCodeUrl: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
}

export interface ChargeList {
  items: Charge[];
  total: number;
}

export interface Metrics {
  totalBilledCents: number;
  totalReceivedCents: number;
  netProfitCents: number;
  activeChargesCount: number;
  activeChargesAmountCents: number;
  defaultRatePercent: number;
  maturedCount: number;
  maturedUnpaid: number;
  mrrCents: number;
  projection30dCents: number;
}

export interface CashflowPoint {
  day: string;
  receivedCents: number;
  pendingCents: number;
}

export interface Settings {
  gatewayProvider: 'ASAAS' | 'MERCADO_PAGO' | null;
  gatewayApiKeySet: boolean;
  gatewayApiKeyMasked: string | null;
  /** Assinatura secreta dos webhooks do Mercado Pago (valida o x-signature). */
  mpWebhookSecretSet: boolean;
  mpWebhookSecretMasked: string | null;
  /** Somente leitura: 'EVOLUTION' quando o WhatsApp está conectado via QR Code. */
  whatsappProvider: 'EVOLUTION' | null;
  webhookSecret: string;
  webhookUrl: string;
  messageTemplate: string;
  paidTemplate: string;
}

/** Estado da conexão do WhatsApp (GET /whatsapp/status). */
export type WhatsappStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'NOT_CREATED';

export interface WhatsappConnectResponse {
  connected: boolean;
  qrcode: string | null;
  pairingCode: string | null;
}
