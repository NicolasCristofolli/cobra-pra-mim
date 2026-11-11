/**
 * Troca a ENCRYPTION_KEY re-criptografando todos os segredos salvos (*_enc).
 *
 * Uso (com a API parada ou não — roda numa única transação):
 *   OLD_ENCRYPTION_KEY=<chave atual> NEW_ENCRYPTION_KEY=<chave nova> \
 *     npx tsx --env-file=.env src/db/rotate-encryption-key.ts
 * Depois grave NEW_ENCRYPTION_KEY como ENCRYPTION_KEY no .env e reinicie a API.
 * Se qualquer valor falhar ao decriptar, nada é alterado (ROLLBACK).
 */
import { Client } from 'pg';

const ENC_COLUMNS = [
  'gateway_api_key_enc',
  'whatsapp_token_enc',
  'whatsapp_client_token_enc',
  'webhook_secret_enc',
  'mp_webhook_secret_enc'
] as const;

async function withKey<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = key;
  try {
    return await fn();
  } finally {
    process.env.ENCRYPTION_KEY = previous;
  }
}

async function main(): Promise<void> {
  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  const newKey = process.env.NEW_ENCRYPTION_KEY;
  if (!oldKey || !newKey) throw new Error('Defina OLD_ENCRYPTION_KEY e NEW_ENCRYPTION_KEY');
  if (oldKey === newKey) throw new Error('As chaves são iguais');

  // Import tardio: crypto lê ENCRYPTION_KEY via env a cada chamada.
  const { encrypt, decrypt } = await import('../lib/crypto');
  await withKey(newKey, () => encrypt('check')); // valida a chave nova (32 bytes)

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Record<string, string | null>>(
      `SELECT id, ${ENC_COLUMNS.join(', ')} FROM settings FOR UPDATE`
    );
    for (const row of rows) {
      // UM update por linha, pela chave primária. (Atualizar coluna a coluna
      // por ctid não funciona: o ctid muda depois do primeiro UPDATE e os
      // seguintes não encontram mais a linha.)
      const sets: string[] = [];
      const values: unknown[] = [row.id];
      for (const column of ENC_COLUMNS) {
        const value = row[column];
        if (!value) continue;
        const plain = await withKey(oldKey, () => decrypt(value));
        values.push(await withKey(newKey, () => encrypt(plain)));
        sets.push(`${column} = $${values.length}`);
      }
      if (sets.length === 0) continue;
      const result = await client.query(
        `UPDATE settings SET ${sets.join(', ')} WHERE id = $1`,
        values
      );
      if (result.rowCount !== 1) {
        throw new Error(`settings ${row.id}: esperava atualizar 1 linha, atualizou ${result.rowCount}`);
      }
      updated += sets.length;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log(`[rotate] ${updated} segredo(s) re-criptografado(s) com a nova chave.`);
}

main().catch((error) => {
  console.error('[rotate] falhou, nada foi alterado:', error);
  process.exit(1);
});
