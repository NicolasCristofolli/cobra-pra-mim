/**
 * Cria (ou promove) um administrador. Admin tem acesso sem assinatura.
 *
 *   ADMIN_NAME='Fulano' ADMIN_EMAIL='fulano@x.com' ADMIN_PASSWORD='...' \
 *     npx tsx --env-file=.env src/db/create-admin.ts
 *
 * A senha vem por variável de ambiente para não ficar no histórico do shell
 * como argumento nem em arquivo. Se o e-mail já existe, a conta vira ADMIN,
 * recebe a senha nova e tem as sessões abertas encerradas.
 */
import { closePool, queryOne, withTransaction } from './index';
import { createAccount, hashPassword } from '../modules/auth/auth.service';
import { newPasswordSchema, sanitizeText } from '../modules/auth/auth.schemas';

async function main(): Promise<void> {
  const name = sanitizeText(process.env.ADMIN_NAME ?? '');
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
    throw new Error('Defina ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD (mínimo 8 caracteres)');
  }

  const policy = newPasswordSchema.safeParse(password);
  if (!policy.success) {
    console.warn(
      `[admin] ATENÇÃO: a senha de ${email} não atende à política do cadastro ` +
        `(${policy.error.issues.map((issue) => issue.message).join('; ')}). Troque depois em "Esqueci minha senha".`
    );
  }

  const passwordHash = await hashPassword(password);
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);

  if (existing) {
    await queryOne(
      `UPDATE users
          SET name = $1, password_hash = $2, role = 'ADMIN', token_version = token_version + 1
        WHERE id = $3`,
      [name, passwordHash, existing.id]
    );
    console.log(`[admin] ${email} promovido a ADMIN (id ${existing.id}).`);
  } else {
    const created = await withTransaction((tx) =>
      createAccount(tx, { name, email, passwordHash, role: 'ADMIN' })
    );
    console.log(`[admin] ${email} criado como ADMIN (id ${created.id}).`);
  }
}

main()
  .catch((error) => {
    console.error('[admin] falhou:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
