export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/** '2026-07-06' → '06/07/2026' (sem pegadinha de fuso). */
export function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** 5551999998888 → +55 (51) 99999-8888 */
export function formatPhoneBR(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  const local = clean.startsWith('55') ? clean.slice(2) : clean;
  if (local.length < 10) return digits;
  const ddd = local.slice(0, 2);
  const number = local.slice(2);
  const split = number.length === 9 ? 5 : 4;
  return `+55 (${ddd}) ${number.slice(0, split)}-${number.slice(split)}`;
}

/** Máscara "de caixa eletrônico": dígitos entram pela direita. */
export function centsToInputText(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function inputTextToCents(text: string): number {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/** Exige usuário@domínio.tld — domínio com pelo menos um ponto e TLD de 2+ letras (.com, .com.br etc). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

/** true para "00000000000", "11111111111" etc. — números/documentos placeholder. */
export function isRepeatedDigits(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/** Dígito verificador padrão de CPF (mod-11). */
export function isValidCPF(doc: string): boolean {
  const cpf = doc.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || isRepeatedDigits(cpf)) return false;
  const digit = (base: number) => {
    let sum = 0;
    for (let i = 0; i < base; i++) sum += Number(cpf[i]) * (base + 1 - i);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Dígito verificador padrão de CNPJ (mod-11). */
export function isValidCNPJ(doc: string): boolean {
  const cnpj = doc.replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj) || isRepeatedDigits(cnpj)) return false;
  const digit = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

/** Valida CPF (11 dígitos) ou CNPJ (14 dígitos) conforme o tamanho digitado. */
export function isValidDocument(doc: string): boolean {
  const digits = doc.replace(/\D/g, '');
  if (digits.length === 11) return isValidCPF(digits);
  if (digits.length === 14) return isValidCNPJ(digits);
  return false;
}

export const RECURRENCE_LABEL: Record<string, string> = {
  NONE: 'Avulsa',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual'
};
