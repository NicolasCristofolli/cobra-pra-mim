/**
 * Identificação do site e do responsável pelo serviço, usada na página
 * inicial, nos Termos de Uso e na Política de Privacidade.
 *
 * PREENCHA legalName, legalDocument e contactEmail com os dados reais de quem
 * opera o serviço. Enquanto estiverem vazios, as páginas omitem essas
 * informações em vez de mostrar um dado inventado.
 */
export const SITE = {
  name: 'Cobra pra mim',
  url: 'https://cobrapramim.cloud',
  /** Razão social ou nome completo do responsável (controlador dos dados). */
  legalName: '',
  /** CNPJ ou CPF do responsável. */
  legalDocument: '',
  /** E-mail de atendimento e de pedidos sobre dados pessoais. */
  contactEmail: '',
  /** Data da última alteração dos Termos e da Política (DD/MM/AAAA). */
  legalUpdatedAt: '12/11/2026'
} as const;
