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
