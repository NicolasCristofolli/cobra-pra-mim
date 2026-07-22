import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { addDaysISO, todayISO } from '../src/lib/dates';
import {
  buildTestApp,
  createUser,
  loginAgent,
  truncateAll,
  type TestHarness
} from './helpers';

describe('clientes e cobranças — duplicidade, datas e isolamento multi-tenant', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('bloqueia telefone/e-mail/CPF-CNPJ duplicados para o MESMO usuário, mas permite entre usuários diferentes', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const base = {
      name: 'Maria Souza',
      phone: '51999998888',
      email: 'maria@teste.com',
      document: '390.533.447-05'
    };
    const first = await agent.post('/clients').send(base);
    expect(first.status).toBe(201);
    // Telefone normalizado com DDI 55.
    expect(first.body.phone).toBe('5551999998888');

    const samePhone = await agent
      .post('/clients')
      .send({ ...base, name: 'Outra Maria', email: 'outra@teste.com', document: '11222333000181' });
    expect(samePhone.status).toBe(409);

    const sameEmail = await agent
      .post('/clients')
      .send({ ...base, phone: '51999997777', document: '11222333000181' });
    expect(sameEmail.status).toBe(409);

    const sameDocument = await agent
      .post('/clients')
      .send({ ...base, phone: '51999996666', email: 'outra2@teste.com' });
    expect(sameDocument.status).toBe(409);

    // Outro usuário pode usar os mesmos dados — a unicidade é escopada por usuário.
    const otherUser = await createUser();
    const otherAgent = await loginAgent(harness.app, otherUser);
    const acrossTenants = await otherAgent.post('/clients').send(base);
    expect(acrossTenants.status).toBe(201);
  });

  it('rejeita CPF/CNPJ inválido (dígito verificador) e placeholders tipo "000..."', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const zeros = await agent
      .post('/clients')
      .send({ name: 'Fake', phone: '51999995555', document: '000.000.000-00' });
    expect(zeros.status).toBe(400);

    const badChecksum = await agent
      .post('/clients')
      .send({ name: 'Fake 2', phone: '51999994444', document: '123.456.789-00' });
    expect(badChecksum.status).toBe(400);

    const valid = await agent
      .post('/clients')
      .send({ name: 'Real', phone: '51999993333', document: '390.533.447-05' });
    expect(valid.status).toBe(201);
  });

  it('cria DUAS cobranças para o mesmo cliente sem conflito', async () => {
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
      dueDate: addDaysISO(today, 5),
      recurrence: 'NONE'
    });
    const chargeB = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Serviço B',
      amountCents: 20000,
      dueDate: addDaysISO(today, 15),
      recurrence: 'NONE'
    });

    expect(chargeA.status).toBe(201);
    expect(chargeB.status).toBe(201);
    expect(chargeA.body.id).not.toBe(chargeB.body.id);

    const list = await agent.get('/charges');
    expect(list.body.total).toBe(2);
  });

  it('recusa criar cobrança com vencimento retroativo', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'Cliente Data', phone: '51988886666', document: '39053344705' });

    const rejected = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Retroativa',
      amountCents: 1000,
      dueDate: addDaysISO(today, -1),
      recurrence: 'NONE'
    });
    expect(rejected.status).toBe(400);

    const acceptedToday = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Vence hoje',
      amountCents: 1000,
      dueDate: today,
      recurrence: 'NONE'
    });
    expect(acceptedToday.status).toBe(201);
  });

  it('dois clientes distintos do mesmo usuário têm faturas independentes', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const academia = await agent
      .post('/clients')
      .send({ name: 'Academia Corpo em Forma', phone: '51977776666', document: '11222333000181' });
    const socio = await agent
      .post('/clients')
      .send({ name: 'Pedro Alves', phone: '51977775555', document: '39053344705' });

    expect(academia.status).toBe(201);
    expect(socio.status).toBe(201);

    for (const target of [academia.body.id, socio.body.id]) {
      const response = await agent.post('/charges').send({
        clientId: target,
        description: 'Mensalidade',
        amountCents: 9900,
        dueDate: addDaysISO(today, 10),
        recurrence: 'MONTHLY',
        recurrenceEndDate: addDaysISO(today, 400)
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
      dueDate: addDaysISO(today, 5),
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
      dueDate: addDaysISO(today, 8),
      recurrence: 'NONE'
    });
    const paid = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Fatura já paga',
      amountCents: 8000,
      dueDate: today,
      recurrence: 'NONE'
    });
    await agent.post(`/charges/${paid.body.id}/pay`);

    const deletion = await agent.delete(`/clients/${client.body.id}`);
    expect(deletion.status).toBe(200);
    expect(deletion.body.canceledCharges).toBe(1);
    expect(deletion.body.canceledChargeIds).toEqual([pending.body.id]);

    // Cliente some das listagens (soft delete).
    expect((await agent.get(`/clients/${client.body.id}`)).status).toBe(404);
    const list = await agent.get('/charges');
    expect(list.body.total).toBe(2);
    const byId = new Map(
      list.body.items.map((c: { id: string; status: string; clientId: string | null }) => [
        c.id,
        c
      ])
    );
    expect(byId.get(pending.body.id)).toMatchObject({ status: 'CANCELED' });
    expect(byId.get(paid.body.id)).toMatchObject({ status: 'PAID' });
  });

  it('desfaz a exclusão do cliente (restore) e reativa a fatura auto-cancelada', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'Reversível', phone: '51944442222', document: '39053344705' });
    const pending = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Fatura em aberto',
      amountCents: 5000,
      dueDate: addDaysISO(today, 8),
      recurrence: 'NONE'
    });

    const deletion = await agent.delete(`/clients/${client.body.id}`);
    expect(deletion.body.canceledChargeIds).toEqual([pending.body.id]);

    const restore = await agent.post(`/clients/${client.body.id}/restore`);
    expect(restore.status).toBe(200);
    expect((await agent.get(`/clients/${client.body.id}`)).status).toBe(200);

    const reactivate = await agent.post(`/charges/${pending.body.id}/reactivate`);
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.status).toBe('PENDING');
  });

  it('cancela e reativa uma cobrança (botão "Reativar")', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const client = await agent
      .post('/clients')
      .send({ name: 'Cobrança Reversível', phone: '51944441111', document: '39053344705' });
    const charge = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Serviço',
      amountCents: 5000,
      dueDate: addDaysISO(today, 8),
      recurrence: 'NONE'
    });

    const canceled = await agent.post(`/charges/${charge.body.id}/cancel`);
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('CANCELED');

    const reactivated = await agent.post(`/charges/${charge.body.id}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('PENDING');

    // Já não está mais cancelada — reativar de novo é 409.
    const alreadyActive = await agent.post(`/charges/${charge.body.id}/reactivate`);
    expect(alreadyActive.status).toBe(409);
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
      dueDate: addDaysISO(today, 20),
      recurrence: 'NONE'
    });

    const updated = await agent.put(`/charges/${charge.body.id}`).send({
      description: 'Corrigida',
      amountCents: 2500,
      dueDate: addDaysISO(today, 30)
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      description: 'Corrigida',
      amountCents: 2500,
      status: 'PENDING'
    });

    await agent.post(`/charges/${charge.body.id}/pay`);
    const blocked = await agent.put(`/charges/${charge.body.id}`).send({
      description: 'Tarde demais',
      amountCents: 1,
      dueDate: addDaysISO(today, 45)
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
      dueDate: addDaysISO(today, 10),
      recurrence: 'MONTHLY'
    });
    expect(rejected.status).toBe(400);

    // ANUAL pode rodar sem limite (campo opcional).
    const yearly = await agent.post('/charges').send({
      clientId: client.body.id,
      description: 'Anuidade',
      amountCents: 50000,
      dueDate: addDaysISO(today, 10),
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
