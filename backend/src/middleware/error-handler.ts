import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Dados inválidos',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
    return;
  }

  // Erros do body-parser: não viram 500 nem ecoam o corpo recebido.
  const parserError = error as { type?: string };
  if (parserError?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Dados enviados são grandes demais' });
    return;
  }
  if (parserError?.type === 'entity.parse.failed' || parserError?.type === 'encoding.unsupported') {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  const pgError = error as PgError;
  if (pgError?.code === '23505') {
    // unique_violation — ex.: e-mail já cadastrado ou ciclo duplicado da série
    res.status(409).json({ error: 'Registro duplicado', constraint: pgError.constraint });
    return;
  }
  if (pgError?.code === '23503') {
    // foreign_key_violation — ex.: excluir cliente que tem cobranças
    res.status(409).json({
      error:
        'Este registro está vinculado a outros dados. ' +
        'Exclua ou cancele os vínculos antes (o histórico de faturas é preservado).'
    });
    return;
  }

  console.error('[erro não tratado]', error);
  res.status(500).json({ error: 'Erro interno do servidor' });
}
