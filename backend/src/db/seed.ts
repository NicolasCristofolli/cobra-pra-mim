import bcrypt from 'bcryptjs';
import { closePool, query, queryOne } from './index';
import { encrypt } from '../lib/crypto';
import { addDaysISO, todayISO } from '../lib/dates';
import { createCharge } from '../modules/charges/charges.repo';
import {
  DEFAULT_CHARGE_TEMPLATE,
  DEFAULT_PAID_TEMPLATE
} from '../lib/template';

/**
 * Popula o banco com uma conta demo pronta para navegar:
 *   e-mail: demo@cobrapramim.com  |  senha: cobra123
 *
 * Os dados propositalmente exercitam os requisitos do produto:
 *   - duas clientes HOMÔNIMAS (mesmo nome, pessoas diferentes);
 *   - dois clientes que COMPARTILHAM telefone;
 *   - faturas em todos os status, relativas à data de hoje;
 *   - uma série recorrente mensal vencendo hoje (o motor gera o próximo ciclo).
 *
 * Idempotente: apagar e recriar a conta demo não toca em outros usuários.
 */
const DEMO_EMAIL = 'demo@cobrapramim.com';
const DEMO_PASSWORD = 'cobra123';
export const DEMO_WEBHOOK_SECRET = 'demo-webhook-secret-2f8a1c';

async function seed(): Promise<void> {
  const today = todayISO();

  await query('DELETE FROM users WHERE email = $1', [DEMO_EMAIL]);

  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Conta Demo', DEMO_EMAIL, await bcrypt.hash(DEMO_PASSWORD, 10)]
  );
  const userId = user!.id;

  await query(
    `INSERT INTO settings (user_id, webhook_secret_enc, message_template, paid_template)
     VALUES ($1, $2, $3, $4)`,
    [userId, encrypt(DEMO_WEBHOOK_SECRET), DEFAULT_CHARGE_TEMPLATE, DEFAULT_PAID_TEMPLATE]
  );

  const insertClient = async (
    name: string,
    phone: string,
    extra: { email?: string; document?: string; notes?: string } = {}
  ) => {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO clients (user_id, name, phone, email, document, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, name, phone, extra.email ?? null, extra.document ?? null, extra.notes ?? null]
    );
    return row!.id;
  };

  const joao = await insertClient('João da Silva', '5551999110001', {
    email: 'joao.silva@example.com',
    notes: 'Mensalidade de consultoria'
  });
  // Homônimas de propósito: identidades distintas, mesmo nome.
  const maria1 = await insertClient('Maria Souza', '5551999110002', {
    document: '390.533.447-05'
  });
  const maria2 = await insertClient('Maria Souza', '5551999110003', {
    notes: 'Maria da loja do centro (homônima da outra Maria)'
  });
  // Telefone compartilhado de propósito: academia e sócio usam o mesmo número.
  const academia = await insertClient('Academia Corpo em Forma', '5551988220004', {
    document: '12.345.678/0001-95'
  });
  const pedro = await insertClient('Pedro Alves', '5551988220004', {
    notes: 'Sócio da academia — mesmo telefone comercial'
  });
  const carla = await insertClient('Carla Menezes', '5551977330005', {
    email: 'carla@example.com'
  });

  // ---- Faturas ----
  // Série recorrente MENSAL vencendo hoje: o cron de hoje envia a cobrança
  // e materializa o ciclo do mês que vem.
  const mensalidadeJoao = await createCharge({
    userId,
    clientId: joao,
    description: 'Mensalidade de consultoria',
    amountCents: 15000,
    dueDate: today,
    recurrence: 'MONTHLY'
  });

  // Avulsa vencendo hoje.
  await createCharge({
    userId,
    clientId: maria1,
    description: 'Serviço de manutenção',
    amountCents: 8990,
    dueDate: today,
    recurrence: 'NONE'
  });

  // A vencer em 5 dias.
  await createCharge({
    userId,
    clientId: maria2,
    description: 'Projeto vitrine — parcela 2/3',
    amountCents: 25000,
    dueDate: addDaysISO(today, 5),
    recurrence: 'NONE'
  });

  // Atrasada há 3 dias (o motor também marcaria; o seed já deixa OVERDUE).
  const atrasada = await createCharge({
    userId,
    clientId: academia,
    description: 'Manutenção dos equipamentos',
    amountCents: 120000,
    dueDate: addDaysISO(today, -3),
    recurrence: 'NONE'
  });
  await query(`UPDATE charges SET status = 'OVERDUE' WHERE id = $1`, [atrasada.id]);

  // Paga na semana passada (com valor líquido do gateway).
  const pagaSemana = await createCharge({
    userId,
    clientId: pedro,
    description: 'Personal trainer — pacote 10 aulas',
    amountCents: 30000,
    dueDate: addDaysISO(today, -7),
    recurrence: 'NONE'
  });
  await query(
    `UPDATE charges
        SET status = 'PAID',
            paid_at = now() - INTERVAL '6 days',
            net_amount_cents = $2,
            gateway_charge_id = 'seed_pay_0001'
      WHERE id = $1`,
    [pagaSemana.id, 29145]
  );

  // Paga no mês passado.
  const pagaMes = await createCharge({
    userId,
    clientId: carla,
    description: 'Identidade visual completa',
    amountCents: 50000,
    dueDate: addDaysISO(today, -30),
    recurrence: 'NONE'
  });
  await query(
    `UPDATE charges
        SET status = 'PAID', paid_at = now() - INTERVAL '29 days'
      WHERE id = $1`,
    [pagaMes.id]
  );

  // Cancelada.
  const cancelada = await createCharge({
    userId,
    clientId: carla,
    description: 'Sessão extra (cancelada a pedido)',
    amountCents: 7500,
    dueDate: addDaysISO(today, 10),
    recurrence: 'NONE'
  });
  await query(`UPDATE charges SET status = 'CANCELED' WHERE id = $1`, [cancelada.id]);

  console.log('Seed concluído ✔');
  console.log(`  Login:            ${DEMO_EMAIL}`);
  console.log(`  Senha:            ${DEMO_PASSWORD}`);
  console.log(`  Webhook secret:   ${DEMO_WEBHOOK_SECRET}`);
  console.log(`  Fatura recorrente de hoje (série): ${mensalidadeJoao.id}`);
}

if (require.main === module) {
  seed()
    .then(() => closePool())
    .catch((error) => {
      console.error('Seed falhou:', error);
      process.exit(1);
    });
}
