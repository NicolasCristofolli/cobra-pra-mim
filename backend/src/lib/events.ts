import type { Response } from 'express';

/**
 * Barramento SSE em memória, particionado por usuário: o webhook publica
 * "payment" e o dashboard aberto no navegador recarrega as métricas na hora.
 */
const subscribers = new Map<string, Set<Response>>();

export function subscribe(userId: string, res: Response): void {
  if (!subscribers.has(userId)) subscribers.set(userId, new Set());
  subscribers.get(userId)!.add(res);
}

export function unsubscribe(userId: string, res: Response): void {
  const set = subscribers.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) subscribers.delete(userId);
}

export function publish(userId: string, event: { type: string; [key: string]: unknown }): void {
  const set = subscribers.get(userId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
}
