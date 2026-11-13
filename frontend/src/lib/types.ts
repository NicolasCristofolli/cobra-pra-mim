// Espelho dos serializers do backend — a única fonte de verdade de shape.

export type SubscriptionStatus =
  | 'PENDING_PAYMENT'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'EXPIRED'
  | 'CANCELED';

/** Decisão de acesso calculada pelo backend (services/subscription/access.ts). */
export type AccessState = 'FULL' | 'WARNING' | 'BLOCKED';
export type AccessReason = 'OK' | 'ADMIN' | 'TRIAL' | 'PAST_DUE' | 'NO_PLAN' | 'PENDING_PAYMENT' | 'EXPIRED';

export interface Access {
  state: AccessState;
  reason: AccessReason;
  blocksAt: string | null;
}

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  cycle: BillingCycle;
}

export interface Subscription {
  status: SubscriptionStatus;
  planCode: string;
  planName: string;
  priceCents: number;
  cycle: BillingCycle;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  canceledAt: string | null;
}

export interface OpenPayment {
  status: 'PENDING' | 'OVERDUE';
  amountCents: number;
  dueDate: string;
  checkoutUrl: string | null;
}

export interface BillingStatus {
  access: Access;
  subscription: Subscription | null;
  openPayment: OpenPayment | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  /** ADMIN vê o menu de administração (a autorização real é do backend). */
  role: 'USER' | 'ADMIN';
  emailVerified: boolean;
  access: Access;
  subscription: Subscription | null;
}

export type ClientStatus = 'ADIMPLENTE' | 'INADIMPLENTE' | 'SEM_COBRANCAS';

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  document: string | null;
  notes: string | null;
  /** true = cliente pediu para não receber mensagens no WhatsApp. */
  whatsappOptOut: boolean;
  status: ClientStatus;
  openCharges: number;
  overdueCharges: number;
  paidCharges: number;
  createdAt: string;
}

// SENT = mensagem de cobrança já enviada no WhatsApp, aguardando pagamento.
export type ChargeStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELED';
export type Recurrence = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
/** PIX, BOLETO ou UNDEFINED (o cliente escolhe Pix, boleto ou cartão no gateway). */
export type BillingType = 'PIX' | 'BOLETO' | 'UNDEFINED';

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
  billingType: BillingType;
  seriesId: string;
  pixCopyPaste: string | null;
  pixQrCodeUrl: string | null;
  invoiceUrl: string | null;
  /** Página pública da fatura (link para enviar ao cliente). */
  publicUrl: string;
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
  /** Contagem de faturas por situação. open = pendentes + enviadas (ainda não vencidas). */
  statusCounts: { paid: number; open: number; overdue: number };
  clientsTotal: number;
  clientsOverdue: number;
  /** O motor encontrou o WhatsApp desconectado: as cobranças não estão saindo. */
  whatsappDisconnected: boolean;
  /** Envios que falharam nas últimas 24 horas. */
  failedSends24h: number;
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
  /** Régua de cobrança: lembretes antes e depois do vencimento. */
  reminderTemplate: string;
  overdueTemplate: string;
  reminderDaysBefore: number[];
  reminderDaysAfter: number[];
  /** Teto de mensagens automáticas por dia (proteção do número). */
  dailyMessageLimit: number;
  /** Hora do dia (6–20) em que as mensagens automáticas desta conta saem. */
  sendHour: number;
  /** true = não envia em sábados, domingos e feriados nacionais. */
  skipNonBusinessDays: boolean;
  /** Resumo mensal por e-mail. */
  monthlyReportEnabled: boolean;
  /** true = o gateway configurado aceita boleto e cartão (hoje, só o Asaas). */
  boletoAvailable: boolean;
  /** Resultado do cadastro automático do webhook no gateway (só ao salvar a chave). */
  webhookAutoConfig: { status: 'configured' } | { status: 'failed'; error: string } | null;
}

/** Fatura vista pelo cliente final na página pública (/f/<token>). */
export interface PublicCharge {
  sellerName: string;
  clientFirstName: string | null;
  description: string;
  amountCents: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
  paidAt: string | null;
  billingType: BillingType;
  pixCopyPaste: string | null;
  pixQrCodeUrl: string | null;
  invoiceUrl: string | null;
}

/** Primeiros passos (GET /dashboard/onboarding). */
export interface Onboarding {
  steps: { whatsapp: boolean; gateway: boolean; client: boolean; charge: boolean; sent: boolean };
  done: number;
  total: number;
  completed: boolean;
  dismissed: boolean;
}

/** Resultado da importação de clientes (POST /clients/import). */
export interface ImportResult {
  created: number;
  rejected: Array<{ line: number; name: string; reason: string }>;
}

/** Planos exibidos na página inicial (GET /public/plans). */
export interface PublicPlans {
  trialDays: number;
  plans: Plan[];
}

/** Painel do administrador (GET /admin/overview). */
export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  emailVerified: boolean;
  access: Access;
  subscriptionStatus: SubscriptionStatus | null;
  planName: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  whatsappConfigured: boolean;
  whatsappDisconnected: boolean;
  gatewayProvider: string | null;
  clients: number;
  charges: number;
  failedSends24h: number;
  lastSentAt: string | null;
}

export interface AdminOverview {
  summary: {
    accounts: number;
    paying: number;
    trial: number;
    pastDue: number;
    blocked: number;
    unverified: number;
    trialEndingSoon: number;
    whatsappDisconnected: number;
    failedSends24h: number;
    mrrCents: number;
  };
  engine: {
    lastRunAt: string | null;
    lastRunOk: boolean | null;
    recent: Array<{
      ranOn: string;
      ok: boolean;
      finishedAt: string;
      notified: number;
      notifyFailed: number;
      generated: number;
      error: string | null;
    }>;
  };
  accounts: AdminAccount[];
}

/** Estado da conexão do WhatsApp (GET /whatsapp/status). */
export type WhatsappStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'NOT_CREATED';

export interface WhatsappConnectResponse {
  connected: boolean;
  qrcode: string | null;
  pairingCode: string | null;
}
