import { env } from '../config/env';
import { formatBRL } from './format';
import { formatDateBR } from './dates';

export interface TemplateVars {
  nome_cliente: string;
  valor: string;
  data_vencimento: string;
  link_pix: string;
  /** Página pública da fatura (QR Code, valor e status). */
  link_fatura: string;
  descricao: string;
}

/**
 * Interpola {variaveis} no template do usuário. Variáveis desconhecidas
 * viram string vazia — a mensagem nunca sai com "{algo}" cru para o cliente.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (vars as unknown as Record<string, string>)[key];
    return value ?? '';
  });
}

export function buildChargeVars(input: {
  clientName: string;
  amountCents: number;
  dueDate: string;
  description: string;
  pixCopyPaste?: string | null;
  invoiceUrl?: string | null;
  publicToken?: string | null;
}): TemplateVars {
  return {
    nome_cliente: input.clientName,
    valor: formatBRL(input.amountCents),
    data_vencimento: formatDateBR(input.dueDate),
    link_pix: input.pixCopyPaste ?? input.invoiceUrl ?? '',
    link_fatura: input.publicToken ? publicInvoiceUrl(input.publicToken) : '',
    descricao: input.description
  };
}

/** URL da página pública de uma fatura. */
export function publicInvoiceUrl(publicToken: string): string {
  return `${env.frontendOrigin.replace(/\/$/, '')}/f/${publicToken}`;
}

export const DEFAULT_CHARGE_TEMPLATE = [
  'Olá, {nome_cliente}! 👋',
  '',
  'Sua fatura de {valor} ({descricao}) vence em {data_vencimento}.',
  '',
  'Pague com o Pix copia e cola abaixo:',
  '{link_pix}',
  '',
  'Qualquer dúvida, é só responder por aqui. 🙂'
].join('\n');

/**
 * Mesma cobrança, para faturas sem Pix copia e cola (boleto, ou o cliente
 * escolhe a forma de pagamento): em vez do código, vai o link de pagamento.
 * Usado no lugar do modelo padrão quando o usuário não personalizou o texto.
 */
export const DEFAULT_CHARGE_LINK_TEMPLATE = [
  'Olá, {nome_cliente}! 👋',
  '',
  'Sua fatura de {valor} ({descricao}) vence em {data_vencimento}.',
  '',
  'Pague pelo link abaixo:',
  '{link_pix}',
  '',
  'Qualquer dúvida, é só responder por aqui. 🙂'
].join('\n');

export const DEFAULT_PAID_TEMPLATE =
  '{nome_cliente}, recebemos seu pagamento de {valor}. ✅ Obrigado!';

/** Lembrete ANTES do vencimento (régua de cobrança). */
export const DEFAULT_REMINDER_TEMPLATE = [
  'Olá, {nome_cliente}! 👋',
  '',
  'Passando para lembrar: sua fatura de {valor} ({descricao}) vence em {data_vencimento}.',
  '',
  'Veja a fatura e pague com Pix:',
  '{link_fatura}'
].join('\n');

/** Lembrete DEPOIS do vencimento (régua de cobrança). */
export const DEFAULT_OVERDUE_TEMPLATE = [
  'Olá, {nome_cliente}.',
  '',
  'Não identificamos o pagamento da fatura de {valor} ({descricao}), vencida em {data_vencimento}.',
  '',
  'Você pode pagar com Pix por aqui:',
  '{link_fatura}',
  '',
  'Se já pagou, desconsidere esta mensagem. 🙂'
].join('\n');

