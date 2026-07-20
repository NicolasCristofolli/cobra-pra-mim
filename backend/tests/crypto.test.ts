import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, maskSecret, safeEqual } from '../src/lib/crypto';

describe('criptografia AES-256-GCM', () => {
  it('faz roundtrip encrypt → decrypt', () => {
    const secret = 'chave-do-gateway-$aact_abc123';
    const payload = encrypt(secret);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).not.toContain(secret);
    expect(decrypt(payload)).toBe(secret);
  });

  it('gera IVs diferentes a cada chamada (mesmo plaintext ≠ mesmo ciphertext)', () => {
    expect(encrypt('mesmo-valor')).not.toBe(encrypt('mesmo-valor'));
  });

  it('detecta adulteração: GCM autentica o payload', () => {
    const payload = encrypt('valor-sensivel');
    const parts = payload.split('.');
    // corrompe 1 byte do ciphertext
    const corrupted = Buffer.from(parts[3]!, 'base64');
    corrupted[0] = corrupted[0]! ^ 0xff;
    parts[3] = corrupted.toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('safeEqual compara em tempo constante e tolera tamanhos diferentes', () => {
    expect(safeEqual('token-abc', 'token-abc')).toBe(true);
    expect(safeEqual('token-abc', 'token-abd')).toBe(false);
    expect(safeEqual('curto', 'muito-mais-longo')).toBe(false);
  });

  it('maskSecret esconde tudo menos os 4 últimos caracteres', () => {
    expect(maskSecret('sk_live_1a2b3c4d')).toBe('••••3c4d');
    expect(maskSecret('ab')).toBe('••••');
  });
});
