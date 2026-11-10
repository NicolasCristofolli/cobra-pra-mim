import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { query, queryOne, withTransaction } from '../../db';
import { resolveAccess } from '../../services/subscription/access';
import { findSubscriptionByUser } from '../../services/subscription/subscription.repo';
import { serializeSubscription } from '../billing/billing.serializers';
import { asyncHandler, AppError, unauthorized } from '../../lib/errors';
import { encrypt } from '../../lib/crypto';
import { DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE } from '../../lib/template';
import {
  clearAuthCookie,
  noStore,
  requireAuth,
  setAuthCookie,
  signToken
} from '../../middleware/auth';
import { createAuthLimiters } from '../../middleware/rate-limit';
import { loginSchema, registerSchema } from './auth.schemas';

/** Custo do bcrypt. Hashes antigos (10) sobem para 12 no próximo login. */
const BCRYPT_COST = 12;

/**
 * Hash de uma senha aleatória, comparado quando o e-mail não existe: o
 * login leva o mesmo tempo nos dois casos e não revela quais e-mails estão
 * cadastrados.
 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  token_version: number;
}

const publicUser = (user: Pick<UserRow, 'id' | 'name' | 'email'>) => ({
  id: user.id,
  name: user.name,
  email: user.email
});

export default function authRouter(): Router {
  const router = Router();
  const limits = createAuthLimiters();
  router.use(noStore);

  router.post(
    '/register',
    limits.register,
    asyncHandler(async (req, res) => {
      const { name, email, password } = registerSchema.parse(req.body);

      const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      // Revela que o e-mail existe (necessário para a UX de cadastro), mas o
      // limite de 5 cadastros/hora por rede torna a enumeração inviável em escala.
      if (existing) throw new AppError('Este e-mail já está cadastrado', 409, 'EMAIL_TAKEN');

      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

      const user = await withTransaction(async (tx) => {
        // A conta nasce SEM assinatura: o acesso às rotas de negócio só libera
        // depois de escolher o plano e o webhook do Asaas confirmar o pagamento.
        const inserted = await tx.query<UserRow>(
          `INSERT INTO users (name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, name, email, password_hash, token_version`,
          [name, email, passwordHash]
        );
        const created = inserted.rows[0]!;
        // Onboarding: settings já nascem com templates padrão e um segredo de
        // webhook exclusivo (criptografado em repouso).
        await tx.query(
          `INSERT INTO settings (user_id, webhook_secret_enc, message_template, paid_template)
           VALUES ($1, $2, $3, $4)`,
          [
            created.id,
            encrypt(randomBytes(24).toString('hex')),
            DEFAULT_CHARGE_TEMPLATE,
            DEFAULT_PAID_TEMPLATE
          ]
        );
        return created;
      });

      setAuthCookie(res, signToken(user.id, user.token_version));
      res.status(201).json(publicUser(user));
    })
  );

  router.post(
    '/login',
    limits.loginByIp,
    limits.loginByAccount,
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);

      const user = await queryOne<UserRow>(
        'SELECT id, name, email, password_hash, token_version FROM users WHERE email = $1',
        [email]
      );
      // Sempre roda o bcrypt (tempo constante) e responde a mesma mensagem
      // para e-mail inexistente e senha errada.
      const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid) throw unauthorized('E-mail ou senha incorretos');

      if (bcrypt.getRounds(user.password_hash) < BCRYPT_COST) {
        const upgraded = await bcrypt.hash(password, BCRYPT_COST);
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]);
      }

      setAuthCookie(res, signToken(user.id, user.token_version));
      res.json(publicUser(user));
    })
  );

  router.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  /** Encerra a sessão em TODOS os dispositivos (ex.: perdeu o celular, senha vazou). */
  router.post(
    '/logout-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.userId]);
      clearAuthCookie(res);
      res.json({ ok: true });
    })
  );

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await queryOne<Pick<UserRow, 'id' | 'name' | 'email'>>(
        'SELECT id, name, email FROM users WHERE id = $1',
        [req.userId]
      );
      if (!user) throw unauthorized();
      const subscription = await findSubscriptionByUser(user.id);
      res.json({
        ...publicUser(user),
        access: resolveAccess(subscription),
        subscription: serializeSubscription(subscription)
      });
    })
  );

  return router;
}
