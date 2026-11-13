import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/** Buscadores só indexam as páginas públicas; painel, faturas e API ficam de fora. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$', '/termos', '/privacidade'],
        disallow: ['/api/', '/f/', '/dashboard', '/clientes', '/cobrancas', '/mensagens', '/configuracoes', '/planos', '/checkout', '/admin', '/tutorial']
      }
    ],
    sitemap: `${SITE.url}/sitemap.xml`
  };
}
