import { z } from 'zod';

/**
 * Validação e sanitização dos payloads de autenticação.
 *
 * - Objetos `.strict()`: campo desconhecido = 400 (nada de mass assignment).
 * - Texto livre (nome) é normalizado (NFKC), perde caracteres de controle e
 *   invisíveis, marcação HTML e espaços repetidos. O React já escapa na tela,
 *   mas o nome também vai para mensagens de WhatsApp, logs e e-mails.
 * - Senha NUNCA é alterada (nem trim): só validada.
 */

// Controle (C0/C1), formatação invisível (zero-width, bidi override, BOM).
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const HTML_TAG = /<[^>]*>/g;
const ANGLE = /[<>]/g;

export function sanitizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ') // tab/quebra de linha viram espaço ANTES de remover controles
    .replace(INVISIBLE, '')
    .replace(HTML_TAG, '')
    .replace(ANGLE, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** bcrypt só considera os primeiros 72 bytes: acima disso a senha seria truncada em silêncio. */
const BCRYPT_MAX_BYTES = 72;

// Lista curta das senhas mais usadas no Brasil e no mundo (vazamentos públicos).
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000',
  'password', 'password1', 'senha123', 'senha1234', 'mudar123', 'qwerty123',
  'abc12345', 'abcd1234', 'a1b2c3d4', 'iloveyou', 'admin123', 'brasil123',
  'cobrapramim', 'cobra123', '12345abc', 'qwertyui', 'q1w2e3r4', '1q2w3e4r'
]);

const emailSchema = z
  .string({ required_error: 'Informe o e-mail', invalid_type_error: 'E-mail inválido' })
  .max(254, 'E-mail muito longo')
  .transform((value) => value.normalize('NFKC').replace(INVISIBLE, '').trim().toLowerCase())
  .pipe(z.string().email('E-mail inválido'));

/** Login: só limites de tamanho. As regras de força valem no cadastro (contas antigas não quebram). */
const loginPasswordSchema = z
  .string({ required_error: 'Informe a senha', invalid_type_error: 'Senha inválida' })
  .min(1, 'Informe a senha')
  .max(256, 'Senha muito longa');

const newPasswordSchema = z
  .string({ required_error: 'Informe a senha', invalid_type_error: 'Senha inválida' })
  .min(8, 'A senha precisa de pelo menos 8 caracteres')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES, 'A senha pode ter no máximo 72 caracteres')
  .refine((value) => value.trim().length === value.length, 'A senha não pode começar nem terminar com espaço')
  .refine((value) => /\p{L}/u.test(value) && /\p{N}/u.test(value), 'A senha precisa ter letras e números')
  .refine((value) => !/^(.)\1+$/u.test(value), 'A senha não pode ser um caractere repetido')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), 'Essa senha é muito comum. Escolha outra.');

const nameSchema = z
  .string({ required_error: 'Informe seu nome', invalid_type_error: 'Nome inválido' })
  .max(200, 'Nome muito longo')
  .transform(sanitizeText)
  .pipe(
    z
      .string()
      .min(2, 'Informe seu nome')
      .max(80, 'O nome pode ter no máximo 80 caracteres')
      .refine((value) => /\p{L}/u.test(value), 'O nome precisa ter letras')
  );

export const loginSchema = z
  .object({ email: emailSchema, password: loginPasswordSchema })
  .strict();

export const registerSchema = z
  .object({ name: nameSchema, email: emailSchema, password: newPasswordSchema })
  .strict()
  .superRefine((data, ctx) => {
    const local = data.email.split('@')[0] ?? '';
    if (local.length >= 4 && data.password.toLowerCase().includes(local)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'A senha não pode conter o seu e-mail'
      });
    }
  });
