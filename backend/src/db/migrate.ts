import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

// Chave arbitrária do advisory lock: duas instâncias subindo ao mesmo tempo
// não aplicam a mesma migration em paralelo.
const MIGRATION_LOCK_KEY = 823_417_001;

/**
 * Aplica as migrations pendentes de db/migrations, em ordem de nome.
 *
 * Cada arquivo roda inteiro dentro de UMA transação, junto com o registro em
 * schema_migrations: se um comando falhar, nada daquele arquivo fica aplicado
 * e o próximo boot tenta de novo do zero (antes, uma falha no meio deixava o
 * banco meio migrado e o boot seguinte quebrava em "already exists").
 *
 * O arquivo é enviado como um único comando multi-statement, então
 * ponto-e-vírgula em comentários ou strings não é mais problema.
 */
export async function runMigrations(): Promise<string[]> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 5000
  });
  await client.connect();

  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         run_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    const dir = path.resolve(__dirname, '../../db/migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name
      )
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error(`[db] erro ao aplicar a migration ${file} (nada dela foi aplicado):`, error);
        throw error;
      }
    }
  } finally {
    // Encerrar a conexão também libera o advisory lock.
    await client.end().catch(() => undefined);
  }
  return applied;
}

if (require.main === module) {
  runMigrations()
    .then((applied) => {
      console.log(
        applied.length > 0
          ? `Migrations aplicadas: ${applied.join(', ')}`
          : 'Banco já está atualizado.'
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error('Falha ao migrar:', error);
      process.exit(1);
    });
}
