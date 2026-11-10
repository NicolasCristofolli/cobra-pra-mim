import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db';
import { resolveAccess } from '../../services/subscription/access';
import { findSubscriptionByUser } from '../../services/subscription/subscription.repo';
import { serializeSubscription } from '../billing/billing.serializers';
import { asyncHandler, AppError, unauthorized } from '../../lib/errors';
import { encrypt } from '../../lib/crypto';
import { DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE } from '../../lib/template';
import {
  clearAuthCookie,
  requireAuth,
  setAuthCookie,
  signToken
} from '../../middleware/auth';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // A suíte faz dezenas de logins pelo mesmo IP em segundos.
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Muitas tentativas de login. Aguarde um minuto.' }
});

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres')
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, 'Informe seu nome')
});

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    if (existing) throw new AppError('Este e-mail já está cadastrado', 409);

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await withTransaction(async (tx) => {
      // A conta nasce SEM assinatura: o acesso às rotas de negócio só libera
      // depois de escolher o plano e o webhook do Asaas confirmar o pagamento.
      const inserted = await tx.query<UserRow>(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, password_hash`,
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

    setAuthCookie(res, signToken(user.id));
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);

    const user = await queryOne<UserRow>(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [email]
    );
    // Mesma mensagem para usuário inexistente e senha errada: não vaza
    // quais e-mails existem na base.
    const valid = user && (await bcrypt.compare(password, user.password_hash));
    if (!valid) throw unauthorized('E-mail ou senha incorretos');

    setAuthCookie(res, signToken(user.id));
    res.json({ id: user.id, name: user.name, email: user.email });
  })
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await queryOne<Omit<UserRow, 'password_hash'>>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );
    if (!user) throw unauthorized();
    const subscription = await findSubscriptionByUser(user.id);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      access: resolveAccess(subscription),
      subscription: serializeSubscription(subscription)
    });
  })
);

export default router;

/** Reuso interno (seed e testes). */
export async function findUsers() {
  return query<{ id: string; email: string }>('SELECT id, email FROM users');
}
