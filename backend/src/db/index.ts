import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../config/env';

// DATE (oid 1082) chega como string 'YYYY-MM-DD' — nunca como Date local,
// o que eliminaria bugs de fuso em datas de vencimento.
types.setTypeParser(1082, (value) => value);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // connectionTimeoutMillis: com o pool esgotado, a requisição falha em 10s em
    // vez de ficar pendurada para sempre (e travar a API inteira).
    pool = new Pool({ connectionString: env.databaseUrl, max: 10, connectionTimeoutMillis: 10_000 });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
