import type { Metadata } from 'next';
import { ContactChannel, LegalPage, LegalSection, ResponsibleParty } from '@/components/legal-page';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Política de Privacidade — ${SITE.name}`,
  description: `Como o ${SITE.name} trata dados pessoais, de acordo com a LGPD.`
};

export default function PrivacidadePage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      intro={`Esta política explica quais dados pessoais o ${SITE.name} trata, para quê, com quem compartilha e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).`}
    >
      <LegalSection title="1. Quem trata os dados">
        <p>
          <ResponsibleParty />
        </p>
        <p>Há dois tipos de pessoas cujos dados passam pelo sistema:</p>
        <ul>
          <li>
            <strong>Você, que tem uma conta</strong>: para os seus dados de cadastro, o {SITE.name}{' '}
            é o controlador.
          </li>
          <li>
            <strong>Os clientes de quem tem uma conta</strong> (quem recebe as cobranças): para
            esses dados, o controlador é o titular da conta que os cadastrou, e o {SITE.name} é o
            operador, que só trata os dados para executar o serviço.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. Quais dados tratamos">
        <ul>
          <li>
            <strong>Da sua conta:</strong> nome, e-mail, senha (guardada apenas como hash,
            impossível de ler), CPF ou CNPJ informado na assinatura do plano, situação da
            assinatura e registros de acesso (como o endereço IP em pedidos de troca de senha).
          </li>
          <li>
            <strong>Dos seus clientes:</strong> nome, telefone, e-mail (opcional), CPF ou CNPJ,
            observações que você escrever, as cobranças (descrição, valor, vencimento, situação) e
            o histórico das mensagens enviadas.
          </li>
          <li>
            <strong>Das integrações:</strong> a chave de API do gateway de pagamento e os dados da
            conexão do WhatsApp, guardados criptografados.
          </li>
        </ul>
        <p>Não guardamos dados de cartão de crédito: eles ficam com o gateway de pagamento.</p>
      </LegalSection>

      <LegalSection title="3. Para que usamos e com qual base legal">
        <ul>
          <li>
            <strong>Prestar o serviço</strong> (criar cobranças, enviar mensagens, dar baixa em
            pagamentos, mostrar relatórios): execução do contrato.
          </li>
          <li>
            <strong>Cobrar a assinatura</strong> e cumprir obrigações fiscais: execução do contrato
            e obrigação legal.
          </li>
          <li>
            <strong>Segurança</strong> (prevenir fraude e acesso indevido) e avisos sobre a conta
            (confirmação de e-mail, WhatsApp desconectado, fim do teste, resumo mensal): legítimo
            interesse. O resumo mensal pode ser desligado no painel.
          </li>
        </ul>
        <p>
          Não vendemos dados pessoais nem os usamos para publicidade de terceiros. Não enviamos
          mensagens aos seus clientes por conta própria: toda mensagem a eles é uma cobrança
          configurada por você.
        </p>
      </LegalSection>

      <LegalSection title="4. Com quem compartilhamos">
        <p>Só com quem é necessário para o serviço funcionar:</p>
        <ul>
          <li>
            <strong>Gateway de pagamento que você conectou</strong> (Asaas ou Mercado Pago): recebe
            nome, CPF/CNPJ, telefone e e-mail do cliente para emitir a cobrança.
          </li>
          <li>
            <strong>WhatsApp</strong>: as mensagens são enviadas pelo seu número aos telefones dos
            seus clientes.
          </li>
          <li>
            <strong>Asaas</strong>, como processador da assinatura do {SITE.name}: recebe seu nome,
            e-mail e CPF/CNPJ.
          </li>
          <li>
            <strong>Provedores de infraestrutura</strong> (hospedagem dos servidores e envio de
            e-mails).
          </li>
          <li>Autoridades, quando houver obrigação legal ou ordem judicial.</li>
        </ul>
        <p>
          Alguns desses provedores podem processar dados fora do Brasil. Nesses casos, a
          transferência segue as regras da LGPD.
        </p>
      </LegalSection>

      <LegalSection title="5. Por quanto tempo guardamos">
        <ul>
          <li>Enquanto a conta existir, os dados ficam disponíveis para você.</li>
          <li>
            Depois do encerramento da conta, os dados são apagados em até 90 dias, exceto o que a
            lei obriga a guardar por mais tempo (por exemplo, registros fiscais da assinatura).
          </li>
          <li>Cópias de segurança são mantidas por tempo limitado e depois descartadas.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Como protegemos">
        <ul>
          <li>Conexão criptografada (HTTPS) em todo o site.</li>
          <li>Senhas guardadas com hash; chaves de integração criptografadas em repouso.</li>
          <li>Cada conta só enxerga os próprios dados.</li>
          <li>
            A página pública da fatura, aberta pelo link enviado ao cliente, mostra apenas o
            necessário para pagar: valor, vencimento, descrição e o primeiro nome.
          </li>
        </ul>
        <p>
          Nenhum sistema é totalmente imune a incidentes. Se ocorrer um incidente que possa trazer
          risco relevante, avisaremos os afetados e a Autoridade Nacional de Proteção de Dados,
          como a lei determina.
        </p>
      </LegalSection>

      <LegalSection title="7. Cookies">
        <p>
          Usamos apenas um cookie essencial, que mantém você conectado depois do login. Não usamos
          cookies de publicidade nem de rastreamento.
        </p>
      </LegalSection>

      <LegalSection title="8. Seus direitos">
        <p>
          Você pode pedir, a qualquer momento: confirmação de que tratamos seus dados, acesso,
          correção, portabilidade, anonimização ou exclusão, informação sobre compartilhamentos e
          revisão de decisões. Basta pedir <ContactChannel />. Você também pode reclamar à
          Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
        <p>
          <strong>Se você recebeu uma cobrança</strong> enviada por alguém que usa o {SITE.name} e
          quer exercer seus direitos (por exemplo, parar de receber mensagens), fale primeiro com
          quem enviou a cobrança, que é o controlador dos seus dados. Se não conseguir, fale
          conosco e encaminharemos o pedido.
        </p>
      </LegalSection>

      <LegalSection title="9. Mudanças nesta política">
        <p>
          Podemos atualizar esta política. Mudanças relevantes serão avisadas por e-mail ou no
          painel. A data da última atualização fica no topo desta página.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
