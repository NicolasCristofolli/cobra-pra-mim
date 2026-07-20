import type { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'Recurso não encontrado') =>
  new AppError(message, 404, 'NOT_FOUND');

export const unauthorized = (message = 'Não autenticado') =>
  new AppError(message, 401, 'UNAUTHORIZED');

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Encaminha rejeições de handlers async para o middleware de erro. */
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
