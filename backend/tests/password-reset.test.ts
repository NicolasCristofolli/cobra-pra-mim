import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { buildTestApp, createUser, loginAgent, truncateAll, type TestHarness } from './helpers';

const NEW_PASSWORD = 'NovaSenha2026';

async function waitForEmails(harness: TestHarness, count: number) {
  for (let i = 0; i < 50 && harness.sentEmails.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return harness.sentEmails;
}

function forgot(harness: TestHarness, email: string, ip = '10.1.0.1') {
  return request(harness.app).post('/auth/forgot-password').set('X-Forwarded-For', ip).send({ email });
}

function reset(harness: TestHarness, token: string, password: string) {
  return request(harness.app).post('/auth/reset-password').send({ token, password });
}

function tokenFromEmail(text: string): string {
  return text.match(/token=([A-Za-z0-9_-]{43})/)![1]!;
}

describe('recuperação de senha', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('fluxo completo: pede, recebe o link, troca a senha e as sessões antigas caem', async () => {
    const user = await createUser({ email: 'maria@example.com' });
    const oldSession = await loginAgent(harness.app, user);

    const asked = await forgot(harness, '  MARIA@example.com ');
    expect(asked.status).toBe(202);
    const [email] = await waitForEmails(harness, 1);
    expect(email!.to).toBe('maria@example.com');
    expect(email!.html).toContain('/redefinir-senha?token=');
    const token = tokenFromEmail(email!.text);

    // Só o hash vai para o banco.
    const stored = await queryOne<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens');
    expect(stored!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored!.token_hash).not.toContain(token);

    expect((await reset(harness, token, NEW_PASSWORD)).status).toBe(200);

    // Senha antiga não entra mais, a nova entra, e a sessão aberta antes caiu.
    expect((await request(harness.app).post('/auth/login').send({ email: user.email, password: user.password })).status).toBe(401);
    expect((await request(harness.app).post('/auth/login').send({ email: user.email, password: NEW_PASSWORD })).status).toBe(200);
    expect((await oldSession.get('/auth/me')).status).toBe(401);

    // O link é de uso único.
    const reused = await reset(harness, token, 'OutraSenha2026');
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('e-mail inexistente: mesma resposta e nenhum e-mail enviado', async () => {
    await createUser({ email: 'existe@example.com' });
    const unknown = await forgot(harness, 'ninguem@example.com');
    const known = await forgot(harness, 'existe@example.com', '10.1.0.2');
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    await waitForEmails(harness, 1);
    expect(harness.sentEmails.map((e) => e.to)).toEqual(['existe@example.com']);
  });

  it('link expirado ou substituído por um pedido novo não funciona', async () => {
    await createUser({ email: 'ana@example.com' });
    await forgot(harness, 'ana@example.com');
    await forgot(harness, 'ana@example.com', '10.1.0.3');
    const [first, second] = await waitForEmails(harness, 2);

    // O pedido mais novo invalida o anterior.
    expect((await reset(harness, tokenFromEmail(first!.text), NEW_PASSWORD)).status).toBe(400);

    await query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
    expect((await reset(harness, tokenFromEmail(second!.text), NEW_PASSWORD)).status).toBe(400);
  });

  it('nova senha passa pela mesma política do cadastro', async () => {
    await createUser({ email: 'joaozinho@example.com' });
    await forgot(harness, 'joaozinho@example.com');
    const [email] = await waitForEmails(harness, 1);
    const token = tokenFromEmail(email!.text);

    expect((await reset(harness, token, '12345678')).status).toBe(400);
    const containsEmail = await reset(harness, token, 'joaozinho2026');
    expect(containsEmail.status).toBe(400);
    expect(containsEmail.body.code).toBe('WEAK_PASSWORD');
    // Os erros de política não queimam o link.
    expect((await reset(harness, token, NEW_PASSWORD)).status).toBe(200);
  });

  it('token malformado e campos extras: 400', async () => {
    expect((await reset(harness, 'curto', NEW_PASSWORD)).status).toBe(400);
    const extra = await request(harness.app)
      .post('/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: NEW_PASSWORD, userId: 'x' });
    expect(extra.status).toBe(400);
  });

  it('limite: 3 pedidos por hora por e-mail', async () => {
    await createUser({ email: 'spam@example.com' });
    for (let i = 0; i < 3; i++) {
      expect((await forgot(harness, 'spam@example.com', `10.2.0.${i}`)).status).toBe(202);
    }
    expect((await forgot(harness, 'spam@example.com', '10.2.0.9')).status).toBe(429);
  });
});

describe('administrador', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('admin sem assinatura tem acesso total; usuário comum sem assinatura não', async () => {
    const admin = await createUser({ subscription: 'NONE' });
    await query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id]);
    const adminAgent = await loginAgent(harness.app, admin);
    expect((await adminAgent.get('/clients')).status).toBe(200);
    expect((await adminAgent.get('/auth/me')).body.access).toMatchObject({ state: 'FULL', reason: 'ADMIN' });
    expect((await adminAgent.get('/billing/access')).body.reason).toBe('ADMIN');

    const regular = await createUser({ subscription: 'NONE' });
    expect((await (await loginAgent(harness.app, regular)).get('/clients')).status).toBe(402);
  });

  it('cadastro público nunca cria admin', async () => {
    const response = await request(harness.app)
      .post('/auth/register')
      .send({ name: 'Esperto', email: 'esperto@example.com', password: 'Cobranca2026', role: 'ADMIN' });
    expect(response.status).toBe(400);
  });
});
