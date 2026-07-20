import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

// Tipografia do design system (substituta livre do "Google Sans" da marca).
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta'
});

export const metadata: Metadata = {
  title: 'Cobra pra mim — cobranças no piloto automático',
  description:
    'Gestão de cobranças recorrentes para pequenos negócios: Pix dinâmico, aviso automático no WhatsApp e baixa em tempo real.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
