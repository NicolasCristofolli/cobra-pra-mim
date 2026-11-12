import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { query, queryOne, withTransaction } from '../../db';
import type { AppDeps } from '../../services/deps';
import {
  findAccessByUser,
  findSubscriptionByUser
} from '../../services/subscription/subscription.repo';
import { serializeSubscription } from '../billing/billing.serializers';
import { asyncHandler, AppError, unauthorized } from '../../lib/errors';
import {
  clearAuthCookie,
  noStore,
  requireAuth,
  setAuthCookie,
  signToken
} from '../../middleware/auth';
import { createAuthLimiters } from '../../middleware/rate-limit';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema
} from './auth.schemas';
import {
  BCRYPT_COST,
  createAccount,
  hashPassword,
  requestPasswordReset,
  resetPassword,
  sendEmailVerification,
  verifyEmail,
  type AccountRow
} from './auth.service';

/**
 * Hash de uma senha aleatória, comparado quando o e-mail não existe: o
 * login leva o mesmo tempo nos dois casos e não revela quais e-mails estão
 * cadastrados.
 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);

type UserRow = AccountRow;

const publicUser = (user: Pick<UserRow, 'id' | 'name' | 'email'>) => ({
  id: user.id,
  name: user.name,
  email: user.email
});

export default function authRouter(deps: Pick<AppDeps, 'mailer'>): Router {
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

      const passwordHash = await hashPassword(password);
      // A conta nasce em teste grátis (TRIAL_DAYS). Depois disso, o acesso só
      // continua com um plano pago, confirmado pelo webhook do Asaas.
      const user = await withTransaction((tx) => createAccount(tx, { name, email, passwordHash }));

      setAuthCookie(res, signToken(user.id, user.token_version));
      res.status(201).json({ ...publicUser(user), emailVerified: false });
      // Envio depois da resposta: SMTP lento não trava o cadastro.
      sendEmailVerification(deps.mailer, user.id).catch((error) => {
        console.error('[auth] falha ao enviar o e-mail de confirmação:', error);
      });
    })
  );

  router.post(
    '/login',
    limits.loginByIp,
    limits.loginByAccount,
    asyncHandler(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);

      const user = await queryOne<UserRow>(
        'SELECT id, name, email, password_hash, token_version, role FROM users WHERE email = $1',
        [email]
      );
      // Sempre roda o bcrypt (tempo constante) e responde a mesma mensagem
      // para e-mail inexistente e senha errada.
      const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid) throw unauthorized('E-mail ou senha incorretos');

      if (bcrypt.getRounds(user.password_hash) < BCRYPT_COST) {
        const upgraded = await hashPassword(password);
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]);
      }

      setAuthCookie(res, signToken(user.id, user.token_version));
      res.json(publicUser(user));
    })
  );

  /**
   * Passo 1 da recuperação: sempre responde igual (202), exista o e-mail ou
   * não, e o envio roda depois da resposta para o tempo também não revelar nada.
   */
  router.post(
    '/forgot-password',
    limits.forgotByIp,
    limits.forgotByAccount,
    asyncHandler(async (req, res) => {
      const { email } = forgotPasswordSchema.parse(req.body);
      res.status(202).json({
        ok: true,
        message: 'Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.'
      });
      requestPasswordReset(deps.mailer, email, req.ip).catch((error) => {
        console.error('[auth] falha ao enviar o e-mail de redefinição:', error);
      });
    })
  );

  /** Passo 2: nova senha com o token do e-mail. Derruba todas as sessões abertas. */
  router.post(
    '/reset-password',
    limits.reset,
    asyncHandler(async (req, res) => {
      const { token, password } = resetPasswordSchema.parse(req.body);
      const result = await resetPassword(token, password);
      if (!result.ok) {
        if (result.reason === 'PASSWORD_CONTAINS_EMAIL') {
          throw new AppError('A senha não pode conter o seu e-mail', 400, 'WEAK_PASSWORD');
        }
        throw new AppError(
          'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".',
          400,
          'INVALID_RESET_TOKEN'
        );
      }
      clearAuthCookie(res);
      res.json({ ok: true });
    })
  );

  /** Confirma o e-mail pelo link. Funciona sem login (link aberto em outro aparelho). */
  router.post(
    '/verify-email',
    limits.reset,
    asyncHandler(async (req, res) => {
      const { token } = verifyEmailSchema.parse(req.body);
      if (!(await verifyEmail(token))) {
        throw new AppError(
          'Este link expirou ou já foi usado. Entre na sua conta e peça um novo.',
          400,
          'INVALID_VERIFY_TOKEN'
        );
      }
      res.json({ ok: true });
    })
  );

  /** Reenvia o link de confirmação para o e-mail da conta logada. */
  router.post(
    '/resend-verification',
    requireAuth,
    limits.resendVerification,
    asyncHandler(async (req, res) => {
      if (req.emailVerified) {
        res.json({ ok: true, alreadyVerified: true });
        return;
      }
      await sendEmailVerification(deps.mailer, req.userId);
      res.status(202).json({ ok: true });
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
        emailVerified: req.emailVerified,
        access: await findAccessByUser(user.id),
        subscription: serializeSubscription(subscription)
      });
    })
  );

  return router;
}
