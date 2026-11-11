import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { buildTestApp, createUser, loginAgent, truncateAll, type TestHarness } from './helpers';

async function waitForEmails(harness: TestHarness, count: number) {
  for (let i = 0; i < 50 && harness.sentEmails.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return harness.sentEmails;
}

function tokenFromEmail(text: string): string {
  return text.match(/confirmar-email\?token=([A-Za-z0-9_-]{43})/)![1]!;
}

const verifiedAt = async (email: string) =>
  (await queryOne<{ email_verified_at: Date | null }>('SELECT email_verified_at FROM users WHERE email = $1', [email]))!
    .email_verified_at;

describe('confirmação de e-mail', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp({ withPlatformBilling: true });
  });

  it('cadastro envia o link, bloqueia checkout e painel até confirmar', async () => {
    const agent = request.agent(harness.app);
    const created = await agent
      .post('/auth/register')
      .send({ name: 'Ana Souza', email: 'ana@example.com', password: 'SenhaBoa2026' });
    expect(created.status).toBe(201);
    expect(created.body.emailVerified).toBe(false);

    const [mail] = await waitForEmails(harness, 1);
    expect(mail!.to).toBe('ana@example.com');
    expect(mail!.subject).toMatch(/Confirme seu e-mail/);

    const me = await agent.get('/auth/me');
    expect(me.body.emailVerified).toBe(false);
    expect((await agent.get('/billing/access')).body.emailVerified).toBe(false);

    const checkout = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: '03580256050' });
    expect(checkout.status).toBe(403);
    expect(checkout.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(harness.platformCalls).toHaveLength(0);
    expect((await agent.get('/clients')).status).toBe(403);

    // Link aberto em outro aparelho (sem sessão)
    const verified = await request(harness.app).post('/auth/verify-email').send({ token: tokenFromEmail(mail!.text) });
    expect(verified.status).toBe(200);
    expect(await verifiedAt('ana@example.com')).not.toBeNull();

    expect((await agent.get('/auth/me')).body.emailVerified).toBe(true);
    // Agora passa do gate de e-mail e cai no de assinatura (402, sem plano)
    expect((await agent.get('/clients')).status).toBe(402);
  });

  it('o link só vale uma vez e reenviar invalida o anterior', async () => {
    const user = await createUser({ email: 'bia@example.com', emailVerified: false, subscription: 'NONE' });
    const agent = await loginAgent(harness.app, user);

    expect((await agent.post('/auth/resend-verification')).status).toBe(202);
    expect((await agent.post('/auth/resend-verification')).status).toBe(202);
    const [first, second] = await waitForEmails(harness, 2);

    const old = await request(harness.app).post('/auth/verify-email').send({ token: tokenFromEmail(first!.text) });
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('INVALID_VERIFY_TOKEN');

    const ok = await request(harness.app).post('/auth/verify-email').send({ token: tokenFromEmail(second!.text) });
    expect(ok.status).toBe(200);
    const again = await request(harness.app).post('/auth/verify-email').send({ token: tokenFromEmail(second!.text) });
    expect(again.status).toBe(400);

    // Já confirmado: reenviar não manda mais nada
    const after = await agent.post('/auth/resend-verification');
    expect(after.body.alreadyVerified).toBe(true);
    expect(harness.sentEmails).toHaveLength(2);
  });

  it('link expirado é recusado', async () => {
    const user = await createUser({ email: 'caio@example.com', emailVerified: false });
    const agent = await loginAgent(harness.app, user);
    await agent.post('/auth/resend-verification');
    const [mail] = await waitForEmails(harness, 1);
    await query(`UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute'`);

    const res = await request(harness.app).post('/auth/verify-email').send({ token: tokenFromEmail(mail!.text) });
    expect(res.status).toBe(400);
    expect(await verifiedAt('caio@example.com')).toBeNull();
  });

  it('redefinir a senha pelo e-mail também confirma o e-mail', async () => {
    await createUser({ email: 'davi@example.com', emailVerified: false });
    await request(harness.app).post('/auth/forgot-password').send({ email: 'davi@example.com' });
    const [mail] = await waitForEmails(harness, 1);
    const token = mail!.text.match(/token=([A-Za-z0-9_-]{43})/)![1]!;

    const res = await request(harness.app).post('/auth/reset-password').send({ token, password: 'NovaSenha2026' });
    expect(res.status).toBe(200);
    expect(await verifiedAt('davi@example.com')).not.toBeNull();
  });

  it('reenvio exige login e token malformado é recusado', async () => {
    expect((await request(harness.app).post('/auth/resend-verification')).status).toBe(401);
    expect((await request(harness.app).post('/auth/verify-email').send({ token: 'abc' })).status).toBe(400);
  });
});
