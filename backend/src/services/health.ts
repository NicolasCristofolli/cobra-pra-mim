import { queryOne } from '../db';
import { env } from '../config/env';

export interface DeepHealth {
  ok: boolean;
  database: 'ok' | 'down';
  /** Última execução do motor de cobrança (null = nunca rodou neste banco). */
  lastCycle: { finishedAt: string; ok: boolean } | null;
  problems: string[];
}

// O ciclo roda 1x por dia: 26h sem execução significa que um dia foi pulado.
const STALE_CYCLE_HOURS = 26;

/**
 * Checagem para monitor externo (GET /health/deep): banco respondendo e
 * motor de cobrança rodando em dia e sem erro.
 */
export async function deepHealth(): Promise<DeepHealth> {
  const problems: string[] = [];
  let lastCycle: DeepHealth['lastCycle'] = null;
  let database: DeepHealth['database'] = 'ok';

  try {
    const run = await queryOne<{ finished_at: Date; ok: boolean; stale: boolean }>(
      `SELECT finished_at, ok,
              finished_at < now() - ($1 * interval '1 hour') AS stale
         FROM engine_runs ORDER BY finished_at DESC LIMIT 1`,
      [STALE_CYCLE_HOURS]
    );
    if (run) {
      lastCycle = { finishedAt: run.finished_at.toISOString(), ok: run.ok };
      if (!run.ok) problems.push('a última execução do motor de cobrança falhou');
      if (run.stale && !env.cronDisabled) {
        problems.push(`o motor de cobrança não roda há mais de ${STALE_CYCLE_HOURS}h`);
      }
    }
  } catch {
    database = 'down';
    problems.push('o banco de dados não respondeu');
  }

  return { ok: problems.length === 0, database, lastCycle, problems };
}
