import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

/**
 * Gerencia instâncias da Evolution API — UMA por usuário, criada e operada
 * exclusivamente pelo backend com a API key global (o usuário nunca vê nem
 * informa credenciais da Evolution).
 *
 * SEGURANÇA (isolamento entre contas): o nome da instância é SEMPRE derivado
 * do userId autenticado, nunca de input do cliente. Não existe rota que
 * aceite um nome de instância arbitrário — é isso que impede um usuário de
 * ler o QR Code, o estado ou enviar mensagens pela sessão de WhatsApp de
 * outra conta.
 */

export type EvolutionConnectionState = 'open' | 'connecting' | 'close';

export function instanceNameFor(userId: string): string {
  return `cobra-${userId}`;
}

interface EvolutionResponse<T> {
  status: number;
  data: T | null;
}

async function evolutionFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<EvolutionResponse<T>> {
  const url = `${env.evolutionApiUrl.replace(/\/$/, '')}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', apikey: env.evolutionApiKey },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new AppError(
      `Evolution API indisponível em ${env.evolutionApiUrl}. ` +
        'Verifique se o container Docker está no ar (docker compose up -d evolution).',
      503
    );
  }

  let data: T | null = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { status: response.status, data };
}

/** Estado da conexão da instância do usuário; null = instância não existe. */
export async function getConnectionState(
  userId: string
): Promise<EvolutionConnectionState | null> {
  const { status, data } = await evolutionFetch<{
    instance?: { state?: string };
  }>(`/instance/connectionState/${encodeURIComponent(instanceNameFor(userId))}`);

  if (status === 404) return null;
  if (status >= 400) {
    throw new AppError('Falha ao consultar o estado da conexão do WhatsApp', 502);
  }
  const state = data?.instance?.state;
  if (state === 'open' || state === 'connecting' || state === 'close') return state;
  return null;
}

/** Cria a instância do usuário se ainda não existir (sessão persiste no banco da Evolution). */
export async function ensureInstance(userId: string): Promise<void> {
  if ((await getConnectionState(userId)) !== null) return;

  const { status } = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: {
      instanceName: instanceNameFor(userId),
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true
    }
  });
  // 403 = nome já em uso (corrida benigna entre duas chamadas do mesmo usuário)
  if (status >= 400 && status !== 403) {
    // Causa comum: o container da Evolution não conseguiu falar com o
    // próprio banco Postgres (ver docker/initdb/02-create-evolution-db.sql —
    // só roda na primeira inicialização do volume; um volume reaproveitado
    // de antes desse script pode não ter o banco "evolution" criado).
    throw new AppError(
      'Não foi possível criar a instância de WhatsApp. Verifique os logs do container ' +
        '"evolution" (docker compose logs evolution) — uma causa comum é o banco ' +
        'Postgres "evolution" não existir ainda no volume atual.',
      502
    );
  }
}

export interface QrCodeResult {
  base64: string | null;
  pairingCode: string | null;
}

/** QR Code (imagem base64) para parear o WhatsApp do usuário. */
export async function getQrCode(userId: string): Promise<QrCodeResult> {
  // A Evolution v2 devolve o QR aninhado em `qrcode: { base64, pairingCode }`;
  // versões/rotas mais antigas respondem com os campos na raiz.
  const { status, data } = await evolutionFetch<{
    base64?: string;
    code?: string;
    pairingCode?: string;
    qrcode?: { base64?: string; code?: string; pairingCode?: string };
  }>(`/instance/connect/${encodeURIComponent(instanceNameFor(userId))}`);

  if (status >= 400) {
    throw new AppError('Não foi possível gerar o QR Code; tente novamente', 502);
  }
  return {
    base64: data?.qrcode?.base64 ?? data?.base64 ?? null,
    pairingCode: data?.qrcode?.pairingCode ?? data?.pairingCode ?? null
  };
}

/**
 * Encerra a sessão (logout). A instância continua existindo — reconectar
 * exige ler um novo QR Code no aparelho do próprio usuário.
 */
export async function logoutInstance(userId: string): Promise<void> {
  const { status } = await evolutionFetch(
    `/instance/logout/${encodeURIComponent(instanceNameFor(userId))}`,
    { method: 'DELETE' }
  );
  // 404 = instância não existe (nada a desconectar) — idempotente.
  if (status >= 400 && status !== 404) {
    throw new AppError('Não foi possível desconectar o WhatsApp', 502);
  }
}
