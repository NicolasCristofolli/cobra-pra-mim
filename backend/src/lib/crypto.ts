import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { env } from '../config/env';

const VERSION = 'v1';
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32; // AES-256

function masterKey(): Buffer {
  const raw = env.encryptionKey;
  const candidates = [
    Buffer.from(raw, 'base64'),
    Buffer.from(raw, 'hex'),
    Buffer.from(raw, 'utf8')
  ];
  const key = candidates.find((buffer) => buffer.length === KEY_BYTES);
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY precisa decodificar para exatamente 32 bytes. ' +
        'Gere uma com: openssl rand -base64 32'
    );
  }
  return key;
}

/** Criptografa texto com AES-256-GCM. Formato: v1.<iv>.<authTag>.<cipher> (base64). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join('.');
}

/** Decripta e AUTENTICA (GCM): qualquer byte adulterado lança erro. */
export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Payload criptografado inválido');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey(),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

/** Comparação em tempo constante, segura para strings de tamanhos diferentes. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Consome tempo equivalente mesmo em mismatch de tamanho.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** Máscara para exibir segredos salvos sem revelá-los: ••••1a2b */
export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '••••';
  return `••••${secret.slice(-4)}`;
}
