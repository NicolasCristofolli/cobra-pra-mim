import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}

class SmtpMailer implements MailerPort {
  private readonly transporter: Transporter;

  constructor(private readonly from: string) {
    this.transporter = nodemailer.createTransport({
      host: env.smtpHost!,
      port: env.smtpPort,
      secure: env.smtpPort === 465, // 465 = TLS direto, 587 = STARTTLS
      requireTLS: env.smtpPort !== 465,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass ?? '' } : undefined,
      connectionTimeout: 10_000
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

/**
 * Sem SMTP configurado, o e-mail não sai: o conteúdo vai para o log da API
 * (pm2 logs cobra-api), para dar para testar antes de ter um provedor. O log
 * só é acessível a quem já tem acesso ao servidor.
 */
class LogMailer implements MailerPort {
  async send(message: MailMessage): Promise<void> {
    console.warn(
      `[mailer] SMTP não configurado: e-mail NÃO enviado para ${message.to}.\n` +
        `Assunto: ${message.subject}\n${message.text}`
    );
  }
}

export function buildMailer(): MailerPort {
  return env.smtpHost ? new SmtpMailer(env.mailFrom) : new LogMailer();
}
