import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { ipKey } from '../src/middleware/rate-limit';
import { sanitizeText } from '../src/modules/auth/auth.schemas';
import { buildTestApp, createUser, loginAgent, truncateAll, type TestHarness } from './helpers';

const GOOD_PASSWORD = 'Cobranca2026';

function register(harness: TestHarness, body: object, ip = '10.0.0.1') {
  return request(harness.app).post('/auth/register').set('X-Forwarded-For', ip).send(body);
}

function login(harness: TestHarness, email: string, password: string, ip = '10.0.0.1') {
  return request(harness.app)
    .post('/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password });
}

function sessionCookie(response: request.Response): string {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  return cookies.find((cookie) => cookie.startsWith('cpm_token='))!;
}

function tokenFrom(response: request.Response): string {
  return sessionCookie(response).split(';')[0]!.split('=')[1]!;
}

describe('validação e sanitização (Zod)', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('sanitiza o nome: HTML, invisíveis, controle e espaços', () => {
    expect(sanitizeText('  <b>Maria</b>​   da\tSilva\u0000 ')).toBe('Maria da Silva');
    expect(sanitizeText('<script>alert(1)</script>Ana')).toBe('alert(1)Ana');
    expect(sanitizeText('Ｍａｒｉａ')).toBe('Maria'); // NFKC (largura total)
  });

  it('cadastro normaliza e-mail e nome e devolve só dados públicos', async () => {
    const response = await register(harness, {
      name: '  <i>Maria</i>   Empreendedora ',
      email: '  Maria.Silva@Example.COM ',
      password: GOOD_PASSWORD
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'Maria Empreendedora',
      email: 'maria.silva@example.com',
      emailVerified: false
    });
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash|token/i);
  });

  it('recusa campos desconhecidos (mass assignment) e tipos errados', async () => {
    const extra = await register(harness, {
      name: 'Maria',
      email: 'maria@example.com',
      password: GOOD_PASSWORD,
      token_version: 99
    });
    expect(extra.status).toBe(400);

    const wrongType = await register(harness, { name: ['Maria'], email: { $ne: '' }, password: 12345678 });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it.each([
    ['curta', 'Ab1'],
    ['sem número', 'SomenteLetras'],
    ['sem letra', '9876543210'],
    ['comum', 'senha123'],
    ['repetida', 'aaaaaaaaaa'],
    ['contém o e-mail', 'joaozinho2026'],
    ['espaço nas pontas', ' Cobranca2026'],
    ['mais de 72 bytes', `A1${'é'.repeat(40)}`]
  ])('recusa senha fraca: %s', async (_label, password) => {
    const response = await register(harness, { name: 'João', email: 'joaozinho@example.com', password });
    expect(response.status).toBe(400);
    expect(response.body.issues[0].path).toBe('password');
  });

  it('nome sem letras ou só com marcação é recusado', async () => {
    expect((await register(harness, { name: '<b></b>', email: 'a1@example.com', password: GOOD_PASSWORD })).status).toBe(400);
    expect((await register(harness, { name: '12345', email: 'a2@example.com', password: GOOD_PASSWORD })).status).toBe(400);
  });

  it('corpo acima de 10 kB e JSON quebrado não viram 500', async () => {
    const big = await request(harness.app)
      .post('/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(20_000) });
    expect(big.status).toBe(413);

    const broken = await request(harness.app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(broken.status).toBe(400);
  });
});

describe('sessão, cookie e JWT', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('cookie HttpOnly + SameSite=Lax, token só com id e versão, sem cache', async () => {
    const response = await register(harness, { name: 'Maria', email: 'maria@example.com', password: GOOD_PASSWORD });
    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(response.headers['cache-control']).toBe('no-store');

    const decoded = jwt.decode(tokenFrom(response), { complete: true }) as jwt.Jwt;
    expect(decoded.header.alg).toBe('HS256');
    expect(Object.keys(decoded.payload as object).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub', 'tv']);
  });

  it('recusa token sem assinatura (alg none), com outro segredo ou outra audiência', async () => {
    const user = await createUser();
    const forged = [
      jwt.sign({ sub: user.id, tv: 0 }, '', { algorithm: 'none' as jwt.Algorithm }),
      jwt.sign({ sub: user.id, tv: 0 }, 'outro-segredo-qualquer-com-32-chars!!', {
        issuer: 'cobra-pra-mim-api',
        audience: 'cobra-pra-mim-web'
      }),
      jwt.sign({ sub: user.id, tv: 0 }, process.env.JWT_SECRET!, {
        issuer: 'cobra-pra-mim-api',
        audience: 'outro-app'
      })
    ];
    for (const token of forged) {
      const response = await request(harness.app).get('/auth/me').set('Cookie', `cpm_token=${token}`);
      expect(response.status).toBe(401);
      // O cookie inválido é apagado na resposta.
      expect(sessionCookie(response)).toMatch(/cpm_token=;/);
    }
  });

  it('"sair de todos os dispositivos" derruba sessões já emitidas', async () => {
    const user = await createUser();
    const phone = await loginAgent(harness.app, user);
    const laptop = await loginAgent(harness.app, user);

    expect((await laptop.post('/auth/logout-all')).status).toBe(200);
    expect((await phone.get('/auth/me')).status).toBe(401);
    expect((await laptop.get('/auth/me')).status).toBe(401);

    const again = await loginAgent(harness.app, user);
    expect((await again.get('/auth/me')).status).toBe(200);
  });

  it('token de usuário excluído deixa de valer', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    await query('DELETE FROM users WHERE id = $1', [user.id]);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('login sobe hashes antigos para bcrypt custo 12', async () => {
    const user = await createUser(); // helper grava com custo 4
    await loginAgent(harness.app, user);
    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    expect(bcrypt.getRounds(row!.password_hash)).toBe(12);
  });

  it('mesma resposta para e-mail inexistente e senha errada', async () => {
    const user = await createUser();
    const unknown = await login(harness, 'ninguem@example.com', 'Qualquer123');
    const wrong = await login(harness, user.email, 'SenhaErrada123');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('POST com Origin de outro site é recusado (CSRF); o próprio site passa', async () => {
    const user = await createUser();
    const evil = await request(harness.app)
      .post('/auth/login')
      .set('Origin', 'https://site-malicioso.example')
      .send({ email: user.email, password: user.password });
    expect(evil.status).toBe(403);

    const own = await request(harness.app)
      .post('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: user.email, password: user.password });
    expect(own.status).toBe(200);
  });
});

describe('rate limiting', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('chave de IP agrupa IPv6 por /56 e desembrulha IPv4 mapeado', () => {
    expect(ipKey('2a02:4780:14:b4db::1')).toBe(ipKey('2a02:4780:14:b4ff:dead:beef:1:2'));
    expect(ipKey('2a02:4780:14:b4db::1')).not.toBe(ipKey('2a02:4780:14:c4db::1'));
    expect(ipKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('força bruta distribuída contra UMA conta: bloqueia mesmo trocando de IP', async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) {
      expect((await login(harness, user.email, `Errada${i}abc`, `198.51.100.${i}`)).status).toBe(401);
    }
    const blocked = await login(harness, user.email, user.password, '198.51.100.200');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    // Outra conta não é afetada.
    const other = await createUser();
    expect((await login(harness, other.email, other.password, '198.51.100.201')).status).toBe(200);
  });

  it('varredura de muitas contas a partir do mesmo IP: bloqueia no 21º erro', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login(harness, `alvo${i}@example.com`, 'Tentativa123', '203.0.113.7')).status).toBe(401);
    }
    expect((await login(harness, 'alvo99@example.com', 'Tentativa123', '203.0.113.7')).status).toBe(429);
    // Outro IP segue normal.
    expect((await login(harness, 'alvo99@example.com', 'Tentativa123', '203.0.113.8')).status).toBe(401);
  });

  it('logins certos não consomem o limite', async () => {
    const user = await createUser();
    for (let i = 0; i < 25; i++) {
      expect((await login(harness, user.email, user.password, '203.0.113.50')).status).toBe(200);
    }
  });

  it('cadastro: 5 por hora por rede (IPv6 /56 conta como uma rede)', async () => {
    for (let i = 0; i < 5; i++) {
      const response = await register(
        harness,
        { name: 'Spam', email: `spam${i}@example.com`, password: GOOD_PASSWORD },
        `2001:db8:aa:bb${i}0::${i + 1}`
      );
      expect(response.status).toBe(201);
    }
    const blocked = await register(
      harness,
      { name: 'Spam', email: 'spam9@example.com', password: GOOD_PASSWORD },
      '2001:db8:aa:bbff::9'
    );
    expect(blocked.status).toBe(429);
  });
});
