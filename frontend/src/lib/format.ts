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

export const RECURRENCE_LABEL: Record<string, string> = {
  NONE: 'Avulsa',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual'
};
