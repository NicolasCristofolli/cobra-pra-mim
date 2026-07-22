export function formatBRL(amountCents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(amountCents / 100);
}

/**
 * Normaliza telefone para dígitos com DDI. Números BR de 10–11 dígitos
 * ganham o prefixo 55 automaticamente.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/** true para "00000000000", "11111111111" etc. — números/documentos placeholder. */
export function isRepeatedDigits(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

/** Dígito verificador padrão de CPF (mod-11). */
export function isValidCPF(cpf: string): boolean {
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
export function isValidCNPJ(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || isRepeatedDigits(cnpj)) return false;
  const digit = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i]!;
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}
