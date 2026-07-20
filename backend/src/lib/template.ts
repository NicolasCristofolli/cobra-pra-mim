import { formatBRL } from './format';
import { formatDateBR } from './dates';

export interface TemplateVars {
  nome_cliente: string;
  valor: string;
  data_vencimento: string;
  link_pix: string;
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
}): TemplateVars {
  return {
    nome_cliente: input.clientName,
    valor: formatBRL(input.amountCents),
    data_vencimento: formatDateBR(input.dueDate),
    link_pix: input.pixCopyPaste ?? input.invoiceUrl ?? '',
    descricao: input.description
  };
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

export const DEFAULT_PAID_TEMPLATE =
  '{nome_cliente}, recebemos seu pagamento de {valor}. ✅ Obrigado!';
