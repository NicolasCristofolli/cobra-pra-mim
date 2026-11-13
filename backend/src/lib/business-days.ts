import { addDaysISO, parseISODate, toISODate } from './dates';

/** Feriados nacionais de data fixa (MM-DD). */
const FIXED_HOLIDAYS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25' // Natal
]);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISODate(year, month, day);
}

/**
 * Feriado nacional: os de data fixa e a Sexta-feira Santa (o único móvel que
 * é feriado nacional; Carnaval e Corpus Christi são ponto facultativo).
 */
export function isNationalHoliday(date: string): boolean {
  const { y } = parseISODate(date);
  if (FIXED_HOLIDAYS.has(date.slice(5))) return true;
  return date === addDaysISO(easterSunday(y), -2);
}

export function isWeekend(date: string): boolean {
  const { y, m, d } = parseISODate(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Dia útil = segunda a sexta que não é feriado nacional. */
export function isBusinessDay(date: string): boolean {
  return !isWeekend(date) && !isNationalHoliday(date);
}
