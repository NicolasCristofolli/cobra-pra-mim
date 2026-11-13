/**
 * CSV para abrir direto no Excel/Planilhas em português: separador ";",
 * quebra de linha CRLF e BOM UTF-8 (sem o BOM o Excel troca os acentos).
 */

const BOM = '﻿';

/**
 * Uma célula que começa com = + - @ (ou tab/CR) é interpretada como fórmula
 * pelo Excel. Como nomes e descrições vêm de fora, um apóstrofo na frente
 * neutraliza (CSV injection).
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: string): string {
  const safe = neutralizeFormula(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(';'));
  return BOM + lines.join('\r\n') + '\r\n';
}
