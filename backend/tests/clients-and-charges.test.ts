import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  buildTestApp,
  createUser,
  loginAgent,
  truncateAll,
  type TestHarness
} from './helpers';

describe('clientes e cobranças — identidades duplicadas e isolamento multi-tenant', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('permite DOIS clientes com o MESMO nome e MESMO telefone (UUIDs distintos)', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const payload = { name: 'Maria Souza', phone: '51999998888', document: '390.533.447-05' };
    const first = await agent.post('/clients').send(payload);
    const second = await agent.post('/clients').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    // Telefone normalizado com DDI 55.
    expect(first.body.phone).toBe('5551999998888');

    const list = await agent.get('/clients');
    const marias = list.body.filter((c: { name: string }) => c.name === 'Maria Souza');
    expect(marias).toHaveLength(2);
  });

  it('cria DUAS cobranças para o mesmo cliente (mesmo nome/telefone) sem conflito', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'João da Silva', phone: '51988887777', document: '39053344705' });
    expect(client.status).toBe(201);

    const chargeA = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Serviço A',
      amountCents: 10000,
      dueDate: '2026-07-10',
      recurrence: 'NONE'
    });
    const chargeB = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Serviço B',
      amountCents: 20000,
      dueDate: '2026-07-20',
      recurrence: 'NONE'
    });

    expect(chargeA.status).toBe(201);
    expect(chargeB.status).toBe(201);
    expect(chargeA.body.id).not.toBe(chargeB.body.id);

    const list = await agent.get('/charges');
    expect(list.body.total).toBe(2);
  });

  it('clientes DIFERENTES podem compartilhar o mesmo telefone, cada um com suas faturas', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const academia = await agent
      .post('/clients')
      .send({ name: 'Academia Corpo em Forma', phone: '51977776666', document: '11222333000181' });
    const socio = await agent
      .post('/clients')
      .send({ name: 'Pedro Alves', phone: '51977776666', document: '39053344705' });

    expect(academia.status).toBe(201);
    expect(socio.status).toBe(201);

    for (const target of [academia.body.id, socio.body.id]) {
      const response = await agent.post('/charges').send({
        clientId: target,
        description: 'Mensalidade',
        amountCents: 9900,
        dueDate: '2026-08-01',
        recurrence: 'MONTHLY',
        recurrenceEndDate: '2027-08-31'
      });
      expect(response.status).toBe(201);
    }

    const list = await agent.get('/charges');
    expect(list.body.total).toBe(2);
    const clientIds = list.body.items.map((c: { clientId: string }) => c.clientId);
    expect(new Set(clientIds).size).toBe(2);
  });

  it('anti-IDOR: usuário B não lê, edita nem exclui cliente do usuário A', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const agentA = await loginAgent(harness.app, userA);
    const agentB = await loginAgent(harness.app, userB);

    const created = await agentA
      .post('/clients')
      .send({ name: 'Cliente Secreto', phone: '51966665555', document: '39053344705' });
    const clientId = created.body.id;

    // Leitura direta por id: 404 (indistinguível de inexistente).
    expect((await agentB.get(`/clients/${clientId}`)).status).toBe(404);
    // Escrita: 404, e o registro permanece intacto.
    expect(
      (
        await agentB
          .put(`/clients/${clientId}`)
          .send({ name: 'Hackeado', phone: '51900000000', document: '39053344705' })
      ).status
    ).toBe(404);
    expect((await agentB.delete(`/clients/${clientId}`)).status).toBe(404);

    const stillThere = await agentA.get(`/clients/${clientId}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.name).toBe('Cliente Secreto');

    // Listagens são disjuntas.
    expect((await agentB.get('/clients')).body).toHaveLength(0);
  });

  it('anti-IDOR: usuário B não cria cobrança apontando para cliente do usuário A', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const agentA = await loginAgent(harness.app, userA);
    const agentB = await loginAgent(harness.app, userB);

    const created = await agentA
      .post('/clients')
      .send({ name: 'Cliente A', phone: '51955554444', document: '39053344705' });

    const attempt = await agentB.post('/charges').send({
      clientId: created.body.id,
      description: 'Invasão',
      amountCents: 100,
      dueDate: '2026-07-15',
      recurrence: 'NONE'
    });
    expect(attempt.status).toBe(404);
    expect((await agentA.get('/charges')).body.total).toBe(0);
  });

  it('excluir cliente cancela as faturas abertas e preserva o histórico (sem 409)', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'Com Histórico', phone: '51944443333', document: '39053344705' });
    const pending = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Fatura em aberto',
      amountCents: 5000,
      dueDate: '2026-07-30',
      recurrence: 'NONE'
    });
    const paid = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Fatura já paga',
      amountCents: 8000,
      dueDate: '2026-07-01',
      recurrence: 'NONE'
    });
    await agent.post(`/charges/${paid.body.id}/pay`);

    const deletion = await agent.delete(`/clients/${client.body.id}`);
    expect(deletion.status).toBe(200);
    expect(deletion.body.canceledCharges).toBe(1);

    // Cliente sumiu; faturas ficam no histórico, desvinculadas (clientId null).
    expect((await agent.get(`/clients/${client.body.id}`)).status).toBe(404);
    const list = await agent.get('/charges');
    expect(list.body.total).toBe(2);
    const byId = new Map(
      list.body.items.map((c: { id: string; status: string; clientId: string | null }) => [
        c.id,
        c
      ])
    );
    expect(byId.get(pending.body.id)).toMatchObject({ status: 'CANCELED', clientId: null });
    expect(byId.get(paid.body.id)).toMatchObject({ status: 'PAID', clientId: null });
  });

  it('edita cobrança PENDING (descrição, valor e vencimento) e recusa editar paga', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'Editável', phone: '51933332222', document: '39053344705' });
    const charge = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Original',
      amountCents: 1000,
      dueDate: '2026-08-10',
      recurrence: 'NONE'
    });

    const updated = await agent.put(`/charges/${charge.body.id}`).send({
      description: 'Corrigida',
      amountCents: 2500,
      dueDate: '2026-08-20'
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      description: 'Corrigida',
      amountCents: 2500,
      dueDate: '2026-08-20',
      status: 'PENDING'
    });

    await agent.post(`/charges/${charge.body.id}/pay`);
    const blocked = await agent.put(`/charges/${charge.body.id}`).send({
      description: 'Tarde demais',
      amountCents: 1,
      dueDate: '2026-09-01'
    });
    expect(blocked.status).toBe(409);
  });

  it('recorrência MENSAL/SEMANAL sem data limite é rejeitada (400)', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const client = await agent
      .post('/clients')
      .send({ name: 'Recorrente', phone: '51922221111', document: '39053344705' });

    const rejected = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Mensalidade sem fim',
      amountCents: 9900,
      dueDate: '2026-08-01',
      recurrence: 'MONTHLY'
    });
    expect(rejected.status).toBe(400);

    // ANUAL pode rodar sem limite (campo opcional).
    const yearly = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Anuidade',
      amountCents: 50000,
      dueDate: '2026-08-01',
      recurrence: 'YEARLY'
    });
    expect(yearly.status).toBe(201);
  });

  it('não autenticado recebe 401 em todas as rotas protegidas', async () => {
    for (const path of ['/clients', '/charges', '/dashboard/metrics', '/settings']) {
      const response = await request(harness.app).get(path);
      expect(response.status).toBe(401);
    }
  });
});
