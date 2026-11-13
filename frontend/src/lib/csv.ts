/**
 * Leitura de planilhas CSV no navegador (importação de clientes).
 * Aceita o que o Excel e o Planilhas Google exportam: separador ";" , "," ou
 * tab, campos entre aspas (com aspas duplicadas e quebras de linha dentro),
 * BOM e arquivos em UTF-8 ou Windows-1252 (padrão do Excel no Brasil).
 */

/** Bytes do arquivo -> texto, sem trocar os acentos. */
export function decodeSpreadsheet(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function detectDelimiter(text: string): string {
  // Conta os candidatos na primeira linha, fora de aspas.
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char]!++;
  }
  if (counts[';']! >= counts[',']! && counts[';']! >= counts['\t']!) return ';';
  return counts['\t']! > counts[',']! ? '\t' : ',';
}

/** Texto CSV -> linhas de células (linhas totalmente vazias são descartadas). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows.map((cells) => cells.map((value) => value.trim()));
}

export type ClientColumn = 'name' | 'phone' | 'email' | 'document' | 'notes';

export interface ImportRow {
  name: string;
  phone: string;
  email: string;
  document: string;
  notes: string;
}

const COLUMN_ALIASES: Record<ClientColumn, string[]> = {
  name: ['nome', 'nome completo', 'cliente', 'razao social', 'nome do cliente', 'name'],
  phone: ['telefone', 'whatsapp', 'celular', 'fone', 'contato', 'numero', 'tel', 'phone'],
  email: ['email', 'e-mail', 'e mail'],
  document: ['cpf', 'cnpj', 'cpf/cnpj', 'cpf ou cnpj', 'cpfcnpj', 'cpf cnpj', 'documento', 'document'],
  notes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'notes']
};

const normalizeHeader = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface ParsedClients {
  rows: ImportRow[];
  /** Colunas obrigatórias que não foram encontradas no cabeçalho. */
  missing: ClientColumn[];
}

/** Lê a planilha de clientes: a primeira linha é o cabeçalho. */
export function parseClientSheet(text: string): ParsedClients {
  const [header, ...lines] = parseCsv(text);
  if (!header) return { rows: [], missing: ['name', 'phone', 'document'] };

  const index: Partial<Record<ClientColumn, number>> = {};
  header.forEach((title, position) => {
    const normalized = normalizeHeader(title);
    for (const column of Object.keys(COLUMN_ALIASES) as ClientColumn[]) {
      if (index[column] === undefined && COLUMN_ALIASES[column].includes(normalized)) {
        index[column] = position;
      }
    }
  });

  const missing = (['name', 'phone', 'document'] as ClientColumn[]).filter(
    (column) => index[column] === undefined
  );
  const pick = (cells: string[], column: ClientColumn) =>
    index[column] === undefined ? '' : (cells[index[column]!] ?? '');

  return {
    missing,
    rows: lines.map((cells) => ({
      name: pick(cells, 'name'),
      phone: pick(cells, 'phone'),
      email: pick(cells, 'email'),
      document: pick(cells, 'document'),
      notes: pick(cells, 'notes')
    }))
  };
}

/** Modelo de planilha para baixar (com BOM, para o Excel abrir com acentos). */
export const CLIENT_SHEET_TEMPLATE =
  '﻿Nome;WhatsApp;E-mail;CPF/CNPJ;Observações\r\n' +
  'Maria Souza;(11) 99999-0000;maria@email.com;000.000.000-00;Prefere contato de manhã\r\n';
