import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { query, queryOne, withTransaction } from '../../db';
import { encrypt } from '../../lib/crypto';
import { DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE } from '../../lib/template';
import type { MailerPort } from '../../services/mailer';

/** Custo do bcrypt. Hashes antigos sobem para este valor no próximo login. */
export const BCRYPT_COST = 12;

export type Role = 'USER' | 'ADMIN';

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  token_version: number;
  role: Role;
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

/**
 * Cria o usuário e as configurações iniciais (templates padrão e segredo de
 * webhook exclusivo, criptografado em repouso). Usado pelo cadastro e pelo
 * script de criação de administrador.
 */
export async function createAccount(
  tx: PoolClient,
  input: { name: string; email: string; passwordHash: string; role?: Role }
): Promise<AccountRow> {
  const inserted = await tx.query<AccountRow>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, password_hash, token_version, role`,
    [input.name, input.email, input.passwordHash, input.role ?? 'USER']
  );
  const created = inserted.rows[0]!;
  await tx.query(
    `INSERT INTO settings (user_id, webhook_secret_enc, message_template, paid_template)
     VALUES ($1, $2, $3, $4)`,
    [created.id, encrypt(randomBytes(24).toString('hex')), DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE]
  );
  return created;
}

/* ---------------- Recuperação de senha ---------------- */

const RESET_TTL_MINUTES = 30;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Gera o link de redefinição e envia por e-mail. Só o hash do token vai para
 * o banco, e um pedido novo invalida os anteriores. Quem chama NÃO revela ao
 * cliente se o e-mail existe.
 */
export async function requestPasswordReset(
  mailer: MailerPort,
  email: string,
  requestedIp: string | undefined
): Promise<void> {
  const user = await queryOne<Pick<AccountRow, 'id' | 'name' | 'email'>>(
    'SELECT id, name, email FROM users WHERE email = $1',
    [email]
  );
  if (!user) return;

  const token = randomBytes(32).toString('base64url');
  await withTransaction(async (tx) => {
    await tx.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );
    await tx.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + ($3 * interval '1 minute'), $4)`,
      [user.id, sha256(token), RESET_TTL_MINUTES, requestedIp ?? null]
    );
  });

  const link = `${env.frontendOrigin.replace(/\/$/, '')}/redefinir-senha?token=${token}`;
  const firstName = user.name.split(' ')[0] ?? user.name;
  await mailer.send({
    to: user.email,
    subject: 'Redefinição de senha — Cobra pra mim',
    text:
      `Olá, ${firstName}!\n\n` +
      `Recebemos um pedido para redefinir a senha da sua conta no Cobra pra mim.\n` +
      `Abra o link abaixo em até ${RESET_TTL_MINUTES} minutos:\n\n${link}\n\n` +
      `Se não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html:
      `<p>Olá, ${escapeHtml(firstName)}!</p>` +
      `<p>Recebemos um pedido para redefinir a senha da sua conta no Cobra pra mim.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#3545bc;color:#fff;` +
      `border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>` +
      `<p style="color:#666">O link vale por ${RESET_TTL_MINUTES} minutos e só pode ser usado uma vez.<br>` +
      `Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`
  });
}

export type ResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'INVALID_TOKEN' | 'PASSWORD_CONTAINS_EMAIL' };

/**
 * Troca a senha com um token válido (não usado, não expirado). Na mesma
 * transação: queima o token e os outros pendentes e incrementa token_version,
 * o que derruba todas as sessões abertas (inclusive a de quem pediu o reset
 * no lugar da vítima).
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetResult> {
  return withTransaction(async (tx) => {
    const found = await tx.query<{ id: string; user_id: string; email: string }>(
      `SELECT t.id, t.user_id, u.email
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
        FOR UPDATE OF t`,
      [sha256(token)]
    );
    const row = found.rows[0];
    if (!row) return { ok: false, reason: 'INVALID_TOKEN' };

    const local = row.email.split('@')[0] ?? '';
    if (local.length >= 4 && newPassword.toLowerCase().includes(local)) {
      return { ok: false, reason: 'PASSWORD_CONTAINS_EMAIL' };
    }

    await tx.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
      [await hashPassword(newPassword), row.user_id]
    );
    await tx.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
      [row.user_id]
    );
    return { ok: true, userId: row.user_id };
  });
}

/** Limpeza: tokens com mais de 7 dias não servem para nada. */
export async function purgeOldResetTokens(): Promise<void> {
  await query(`DELETE FROM password_reset_tokens WHERE created_at < now() - interval '7 days'`);
}
