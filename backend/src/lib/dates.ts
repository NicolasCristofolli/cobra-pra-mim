import { env } from '../config/env';

export type RecurrenceKind = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(value: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Data inválida (esperado YYYY-MM-DD): ${value}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`Data inexistente no calendário: ${value}`);
  }
  return { y, m, d };
}

export function toISODate(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDaysISO(date: string, days: number): string {
  const { y, m, d } = parseISODate(date);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return toISODate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

/**
 * Próximo vencimento de uma série recorrente.
 *
 * O `anchorDay` preserva a intenção original da série em meses curtos:
 * uma cobrança criada no dia 31 vence 29/02 em ano bissexto, 28/02 nos
 * demais, e VOLTA para o dia 31 em março — em vez de "derreter" para 28
 * permanentemente.
 */
export function nextDueDate(
  current: string,
  recurrence: RecurrenceKind,
  anchorDay?: number | null
): string {
  const { y, m, d } = parseISODate(current);
  const anchor = anchorDay ?? d;

  switch (recurrence) {
    case 'WEEKLY':
      return addDaysISO(current, 7);
    case 'MONTHLY': {
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      return toISODate(nextYear, nextMonth, Math.min(anchor, daysInMonth(nextYear, nextMonth)));
    }
    case 'YEARLY': {
      const nextYear = y + 1;
      return toISODate(nextYear, m, Math.min(anchor, daysInMonth(nextYear, m)));
    }
    default:
      throw new Error('nextDueDate não se aplica a cobranças sem recorrência');
  }
}

/**
 * Ocorrências futuras de uma série dentro de (fromExclusive, toInclusive],
 * partindo do último vencimento materializado. Usado na projeção de 30 dias.
 */
export function projectOccurrences(
  latestDue: string,
  recurrence: RecurrenceKind,
  anchorDay: number | null,
  fromExclusive: string,
  toInclusive: string
): string[] {
  if (recurrence === 'NONE') return [];
  const occurrences: string[] = [];
  let cursor = latestDue;
  for (let guard = 0; guard < 500; guard++) {
    cursor = nextDueDate(cursor, recurrence, anchorDay);
    if (cursor > toInclusive) break;
    if (cursor > fromExclusive) occurrences.push(cursor);
  }
  return occurrences;
}

/** Data de hoje (YYYY-MM-DD) no fuso do app — 'en-CA' formata exatamente ISO. */
export function todayISO(timeZone: string = env.appTz): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export function formatDateBR(isoDate: string): string {
  const { y, m, d } = parseISODate(isoDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d)}/${pad(m)}/${y}`;
}
