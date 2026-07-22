import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg'; // Mudamos de Pool para Client direto

export async function runMigrations(): Promise<string[]> {
  // Criamos um cliente direto configurando timeouts e forçando IPv4 puro
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    connectionTimeoutMillis: 5000, // Dá tempo para o WSL responder
  });

  // Abre a conexão explicitamente
  await client.connect();

  // Garante a tabela de controle direto
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       run_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const dir = path.resolve(__dirname, '../../db/migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [file]
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');

    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

      const commands = sql
        .split(';')
        .map((cmd) => cmd.trim())
        .filter((cmd) => cmd.length > 0);

      for (const command of commands) {
        console.log("👉 EXECUTANDO COMANDO:", command.substring(0, 60) + "...");
        await client.query(command);
      }
      
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
      
    } catch (error) {
      console.error(`🚨 Erro ao aplicar comando no arquivo [${file}]:`, error);
      throw error;
    }
  }

  // Fecha a conexão do cliente manualmente no fim de tudo
  await client.end();
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