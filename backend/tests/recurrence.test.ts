import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  nextDueDate,
  projectOccurrences
} from '../src/lib/dates';

describe('cálculo de vencimentos recorrentes', () => {
  it('MENSAL preserva o dia-âncora 31 através de meses curtos', () => {
    // Criada em 31/jan/2024 (bissexto): fev vira 29, e março VOLTA ao 31.
    const fev = nextDueDate('2024-01-31', 'MONTHLY', 31);
    expect(fev).toBe('2024-02-29');
    const mar = nextDueDate(fev, 'MONTHLY', 31);
    expect(mar).toBe('2024-03-31');
  });

  it('MENSAL em ano não bissexto: 31/jan → 28/fev → 31/mar', () => {
    const fev = nextDueDate('2025-01-31', 'MONTHLY', 31);
    expect(fev).toBe('2025-02-28');
    expect(nextDueDate(fev, 'MONTHLY', 31)).toBe('2025-03-31');
  });

  it('MENSAL sem âncora explícita usa o dia da própria data', () => {
    expect(nextDueDate('2026-07-15', 'MONTHLY')).toBe('2026-08-15');
    expect(nextDueDate('2026-12-10', 'MONTHLY')).toBe('2027-01-10');
  });

  it('SEMANAL soma exatamente 7 dias, inclusive cruzando mês/ano', () => {
    expect(nextDueDate('2026-07-06', 'WEEKLY')).toBe('2026-07-13');
    expect(nextDueDate('2026-12-29', 'WEEKLY')).toBe('2027-01-05');
  });

  it('ANUAL trata 29/fev: cai para 28 em ano comum e volta ao 29 no bissexto', () => {
    const y2025 = nextDueDate('2024-02-29', 'YEARLY', 29);
    expect(y2025).toBe('2025-02-28');
    const y2026 = nextDueDate(y2025, 'YEARLY', 29);
    const y2027 = nextDueDate(y2026, 'YEARLY', 29);
    const y2028 = nextDueDate(y2027, 'YEARLY', 29);
    expect(y2028).toBe('2028-02-29');
  });

  it('projectOccurrences lista só ocorrências dentro da janela', () => {
    // Série mensal âncora 15, última fatura 15/jul; janela = 30 dias a partir
    // de 06/jul → só a de 15/ago NÃO entra (16/ago > 05/ago? não: entra a de
    // 15/jul? não — já materializada). Confere fronteiras exatas:
    const occurrences = projectOccurrences(
      '2026-07-15',
      'MONTHLY',
      15,
      '2026-07-05', // exclusivo
      '2026-08-05' // inclusivo
    );
    expect(occurrences).toEqual([]); // próxima é 15/ago, fora da janela

    const wide = projectOccurrences('2026-07-15', 'MONTHLY', 15, '2026-07-05', '2026-10-20');
    expect(wide).toEqual(['2026-08-15', '2026-09-15', '2026-10-15']);
  });

  it('addDaysISO cruza fronteiras de mês corretamente', () => {
    expect(addDaysISO('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });
});
