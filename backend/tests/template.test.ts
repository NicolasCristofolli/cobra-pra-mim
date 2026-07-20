import { describe, expect, it } from 'vitest';
import { buildChargeVars, renderTemplate } from '../src/lib/template';

describe('interpolação do template de mensagem', () => {
  const vars = buildChargeVars({
    clientName: 'Maria Souza',
    amountCents: 15990,
    dueDate: '2026-07-10',
    description: 'Mensalidade',
    pixCopyPaste: '00020126PIXDEMO',
    invoiceUrl: 'https://gw/inv/1'
  });

  it('substitui todas as variáveis suportadas', () => {
    const out = renderTemplate(
      'Oi {nome_cliente}, {descricao} de {valor} vence {data_vencimento}. Pix: {link_pix}',
      vars
    );
    expect(out).toContain('Maria Souza');
    expect(out).toContain('Mensalidade');
    expect(out).toContain('159,90'); // BRL pt-BR
    expect(out).toContain('R$');
    expect(out).toContain('10/07/2026');
    expect(out).toContain('00020126PIXDEMO');
  });

  it('variável desconhecida vira vazio — nunca vaza "{chave}" para o cliente', () => {
    expect(renderTemplate('A {foo} B', vars)).toBe('A  B');
  });

  it('sem Pix, {link_pix} usa o invoiceUrl como fallback', () => {
    const semPix = buildChargeVars({
      clientName: 'X',
      amountCents: 100,
      dueDate: '2026-01-01',
      description: 'Y',
      pixCopyPaste: null,
      invoiceUrl: 'https://gw/inv/9'
    });
    expect(renderTemplate('{link_pix}', semPix)).toBe('https://gw/inv/9');
  });
});
