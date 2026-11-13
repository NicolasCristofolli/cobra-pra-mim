'use client';

import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  CLIENT_SHEET_TEMPLATE,
  decodeSpreadsheet,
  parseClientSheet,
  type ClientColumn,
  type ImportRow
} from '@/lib/csv';
import type { ImportResult } from '@/lib/types';
import { Button, Modal } from './ui';

/** Mesmo teto do backend (IMPORT_MAX_ROWS). */
const MAX_ROWS = 500;
const MAX_FILE_BYTES = 1_000_000;

const COLUMN_LABEL: Record<ClientColumn, string> = {
  name: 'Nome',
  phone: 'WhatsApp',
  email: 'E-mail',
  document: 'CPF/CNPJ',
  notes: 'Observações'
};

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; fileName: string; rows: ImportRow[] }
  | { kind: 'done'; result: ImportResult };

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([CLIENT_SHEET_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-clientes.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Importação de clientes por planilha CSV: escolhe o arquivo, confere a
 * prévia e importa. As linhas com problema voltam listadas com o motivo.
 */
export function ClientImportModal({
  open,
  onClose,
  onImported
}: {
  open: boolean;
  onClose: () => void;
  /** Chamado quando pelo menos um cliente entrou (para recarregar a lista). */
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function close() {
    setStep({ kind: 'pick' });
    setError(null);
    setImporting(false);
    onClose();
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError('Arquivo grande demais. Divida a planilha em partes de até 500 clientes.');
      return;
    }
    if (/\.(xlsx?|ods|numbers)$/i.test(file.name)) {
      setError(
        'Este arquivo é uma planilha do Excel. Abra-a e use Arquivo > Salvar como > CSV, depois envie o arquivo .csv.'
      );
      return;
    }
    const parsed = parseClientSheet(decodeSpreadsheet(await file.arrayBuffer()));
    if (parsed.missing.length > 0) {
      setError(
        `Não encontrei ${parsed.missing.length > 1 ? 'as colunas' : 'a coluna'} ` +
          `${parsed.missing.map((column) => COLUMN_LABEL[column]).join(', ')} na primeira linha. ` +
          'Baixe o modelo para ver os nomes das colunas.'
      );
      return;
    }
    if (parsed.rows.length === 0) {
      setError('A planilha só tem o cabeçalho: nenhuma linha de cliente foi encontrada.');
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setError(
        `A planilha tem ${parsed.rows.length} clientes. Importe no máximo ${MAX_ROWS} por vez: divida o arquivo em partes.`
      );
      return;
    }
    setStep({ kind: 'preview', fileName: file.name, rows: parsed.rows });
  }

  async function runImport(rows: ImportRow[]) {
    setImporting(true);
    setError(null);
    try {
      const result = await api<ImportResult>('/clients/import', {
        method: 'POST',
        body: JSON.stringify({ rows })
      });
      setStep({ kind: 'done', result });
      if (result.created > 0) onImported();
    } catch (err) {
      setError(
        err instanceof ApiError && err.issues?.length
          ? err.issues.map((issue) => issue.message).join(' · ')
          : (err as Error).message
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title="Importar clientes"
      subtitle="Traga sua carteira de uma planilha, sem cadastrar um por um."
    >
      {step.kind === 'pick' && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-sand-600">
            <li>
              Monte uma planilha com as colunas <strong className="text-sand-900">Nome</strong>,{' '}
              <strong className="text-sand-900">WhatsApp</strong> e{' '}
              <strong className="text-sand-900">CPF/CNPJ</strong> (obrigatórias),{' '}
              <span className="text-sand-900">E-mail</span> e{' '}
              <span className="text-sand-900">Observações</span> (opcionais).
            </li>
            <li>Salve como CSV (no Excel: Arquivo &gt; Salvar como &gt; CSV).</li>
            <li>Envie o arquivo aqui. Você confere antes de importar.</li>
          </ol>

          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" /> Escolher arquivo CSV
            </Button>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Baixar modelo
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-sand-600">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary-600" />
            <span>
              <strong className="text-sand-900">{step.rows.length}</strong>{' '}
              {step.rows.length === 1 ? 'cliente encontrado' : 'clientes encontrados'} em{' '}
              <span className="break-all">{step.fileName}</span>
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl ring-1 ring-sand-100">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-primary-50 text-[11px] font-bold uppercase tracking-wider text-primary-700">
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">WhatsApp</th>
                  <th className="px-3 py-2">CPF/CNPJ</th>
                  <th className="px-3 py-2">E-mail</th>
                </tr>
              </thead>
              <tbody>
                {step.rows.slice(0, 5).map((row, index) => (
                  <tr key={index} className="border-t border-sand-100 text-sand-700">
                    <td className="px-3 py-2 font-semibold text-sand-900">{row.name || '—'}</td>
                    <td className="px-3 py-2">{row.phone || '—'}</td>
                    <td className="px-3 py-2">{row.document || '—'}</td>
                    <td className="px-3 py-2">{row.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {step.rows.length > 5 && (
            <p className="text-xs text-sand-500">
              Mostrando as 5 primeiras linhas. Linhas com dados inválidos ou repetidos não entram e
              aparecem no resultado, com o motivo.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep({ kind: 'pick' })} disabled={importing}>
              Escolher outro arquivo
            </Button>
            <Button loading={importing} onClick={() => runImport(step.rows)}>
              Importar {step.rows.length} {step.rows.length === 1 ? 'cliente' : 'clientes'}
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'done' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-leaf-50">
              <CheckCircle2 className="h-5 w-5 text-leaf-600" />
            </span>
            <p className="text-sm leading-relaxed text-sand-600">
              <strong className="text-sand-900">
                {step.result.created}{' '}
                {step.result.created === 1 ? 'cliente importado' : 'clientes importados'}.
              </strong>
              {step.result.rejected.length > 0 &&
                ` ${step.result.rejected.length} ${
                  step.result.rejected.length === 1 ? 'linha não entrou' : 'linhas não entraram'
                }: corrija na planilha e importe só elas de novo.`}
            </p>
          </div>
          {step.result.rejected.length > 0 && (
            <ul className="max-h-60 divide-y divide-sand-100 overflow-y-auto rounded-xl text-sm ring-1 ring-sand-100">
              {step.result.rejected.map((item) => (
                <li key={item.line} className="flex gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 text-xs font-bold text-sand-400">
                    Linha {item.line}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold text-sand-900">{item.name || '(sem nome)'}</span>
                    <span className="block text-xs text-danger-600">{item.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button onClick={close}>Concluir</Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-inset ring-danger-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </Modal>
  );
}
