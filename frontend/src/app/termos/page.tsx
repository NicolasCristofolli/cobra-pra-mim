import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactChannel, LegalPage, LegalSection, ResponsibleParty } from '@/components/legal-page';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Termos de Uso — ${SITE.name}`,
  description: `Condições de uso do ${SITE.name}, serviço de cobranças automáticas por WhatsApp.`
};

export default function TermosPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      intro={`Estes termos explicam as regras de uso do ${SITE.name}. Ao criar uma conta, você declara que leu e concorda com eles e com a Política de Privacidade.`}
    >
      <LegalSection title="1. O serviço">
        <p>
          <ResponsibleParty /> O {SITE.name} é um sistema de gestão de cobranças: você cadastra
          seus clientes e as cobranças, e o sistema envia mensagens pelo seu WhatsApp, gera o
          pagamento no gateway que você conectou (Asaas ou Mercado Pago) e registra quando o
          pagamento é confirmado.
        </p>
        <p>
          O {SITE.name} <strong>não é instituição financeira nem intermediador de pagamentos</strong>
          . O dinheiro pago pelos seus clientes vai direto para a sua conta no gateway, segundo as
          regras e tarifas desse gateway. Nós não recebemos, guardamos nem repassamos esses valores.
        </p>
      </LegalSection>

      <LegalSection title="2. Sua conta">
        <ul>
          <li>Você precisa ter pelo menos 18 anos e informar dados verdadeiros.</li>
          <li>
            Você é responsável por manter sua senha em sigilo e por tudo o que for feito na sua
            conta.
          </li>
          <li>
            As chaves do gateway e a conexão do WhatsApp são suas. Você pode removê-las a qualquer
            momento nas Configurações.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Uso do WhatsApp">
        <p>
          As mensagens saem do <strong>seu próprio número</strong>, conectado por QR Code, do mesmo
          jeito que o WhatsApp Web. Essa forma de conexão não é uma integração oficial do WhatsApp,
          e o WhatsApp pode restringir ou banir números que considerar que enviam mensagens em
          excesso ou indesejadas.
        </p>
        <p>
          Para reduzir esse risco, o sistema limita a quantidade de mensagens por dia, espaça os
          envios e permite marcar clientes que não querem receber mensagens. Mesmo assim,{' '}
          <strong>
            não garantimos que o seu número não será restringido, e não nos responsabilizamos por
            bloqueios ou banimentos aplicados pelo WhatsApp
          </strong>
          .
        </p>
      </LegalSection>

      <LegalSection title="4. O que você se compromete a fazer">
        <ul>
          <li>
            Cobrar apenas valores que são realmente devidos, de pessoas com quem você tem relação
            comercial.
          </li>
          <li>
            Ter base legal para tratar os dados dos seus clientes (nome, telefone, CPF/CNPJ,
            e-mail) e para enviar mensagens a eles.
          </li>
          <li>Respeitar o pedido de quem não quer mais receber mensagens.</li>
          <li>
            Não usar o serviço para spam, golpes, cobranças vexatórias ou ameaçadoras, nem para
            qualquer atividade ilegal. O Código de Defesa do Consumidor proíbe expor o devedor ao
            ridículo ou submetê-lo a constrangimento.
          </li>
        </ul>
        <p>
          O conteúdo das mensagens é definido por você. Podemos suspender contas que descumpram
          estas regras.
        </p>
      </LegalSection>

      <LegalSection title="5. Teste grátis, planos e pagamento">
        <ul>
          <li>
            Contas novas têm um período de teste grátis, informado na página inicial, sem
            necessidade de cartão de crédito.
          </li>
          <li>
            Depois do teste, o uso depende de um plano pago (mensal ou anual), com os preços
            informados na página de assinatura. A cobrança do plano é processada pelo Asaas.
          </li>
          <li>
            Se a mensalidade não for paga, a conta continua funcionando por alguns dias de
            tolerância e depois é bloqueada: as mensagens automáticas param até a regularização.
            Seus dados continuam guardados.
          </li>
          <li>
            Você pode cancelar a assinatura quando quiser, na página de assinatura. O acesso
            continua até o fim do período já pago. Quem contrata pela internet pode desistir em até
            7 dias após a primeira contratação e pedir o reembolso, como prevê o Código de Defesa
            do Consumidor.
          </li>
          <li>
            Os preços podem mudar. Avisaremos por e-mail com pelo menos 30 dias de antecedência, e
            a mudança só vale a partir da renovação seguinte.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Disponibilidade e limites de responsabilidade">
        <p>
          Trabalhamos para manter o serviço no ar e as mensagens saindo no horário, mas o envio
          depende de terceiros (WhatsApp, gateways de pagamento, provedores de internet e de
          e-mail) e pode falhar ou atrasar. O painel mostra os envios que falharam.
        </p>
        <p>
          Não respondemos por lucros que você deixou de ter, por cobranças não recebidas ou por
          falhas de serviços de terceiros. Em qualquer caso, nossa responsabilidade fica limitada
          ao valor que você pagou pelo serviço nos 12 meses anteriores ao problema. Nada aqui
          afasta direitos que a lei garante a você como consumidor.
        </p>
      </LegalSection>

      <LegalSection title="7. Seus dados e os dados dos seus clientes">
        <p>
          Os dados dos seus clientes são seus: para eles, você é o controlador e o {SITE.name} é o
          operador, que trata os dados apenas para prestar o serviço. Os detalhes estão na{' '}
          <Link href="/privacidade" className="font-semibold text-primary-600 hover:text-primary-700">
            Política de Privacidade
          </Link>
          . Você pode exportar suas cobranças a qualquer momento e pedir a exclusão da conta.
        </p>
      </LegalSection>

      <LegalSection title="8. Encerramento">
        <p>
          Você pode encerrar sua conta quando quiser, pedindo <ContactChannel />. Podemos suspender
          ou encerrar contas que violem estes termos, avisando por e-mail sempre que possível.
        </p>
      </LegalSection>

      <LegalSection title="9. Mudanças nestes termos e foro">
        <p>
          Podemos atualizar estes termos. Mudanças relevantes serão avisadas por e-mail ou no
          painel antes de entrarem em vigor. Estes termos seguem a lei brasileira, e fica eleito o
          foro do domicílio do consumidor para resolver qualquer disputa.
        </p>
        <p>
          Dúvidas? Fale conosco <ContactChannel />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
