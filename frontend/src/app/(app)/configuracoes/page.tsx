'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, QrCode, RefreshCw, Unplug, Webhook } from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  cx
} from '@/components/ui';
import { api } from '@/lib/api';
import { WebhookTutorial } from '@/components/webhook-tutorial';
import type { Settings, WhatsappConnectResponse, WhatsappStatus } from '@/lib/types';

export default function ConfiguracoesPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  // Campos de segredo: vazio = manter o que está salvo; digitado = substituir.
  const [gatewayProvider, setGatewayProvider] = useState<'' | 'ASAAS' | 'MERCADO_PAGO'>('');
  const [gatewayKeyInput, setGatewayKeyInput] = useState('');
  const [removeGatewayKey, setRemoveGatewayKey] = useState(false);
  const [mpSecretInput, setMpSecretInput] = useState('');
  const [removeMpSecret, setRemoveMpSecret] = useState(false);

  // Conexão do WhatsApp via QR Code (Evolution API, gerenciada pelo backend).
  const [whatsStatus, setWhatsStatus] = useState<WhatsappStatus | 'LOADING'>('LOADING');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function hydrate(data: Settings) {
    setSettings(data);
    setGatewayProvider(data.gatewayProvider ?? '');
    setGatewayKeyInput('');
    setRemoveGatewayKey(false);
    setMpSecretInput('');
    setRemoveMpSecret(false);
  }

  useEffect(() => {
    api<Settings>('/settings')
      .then(hydrate)
      .catch((error) => push('error', (error as Error).message));
    api<{ status: WhatsappStatus }>('/whatsapp/status')
      .then((data) => setWhatsStatus(data.status))
      .catch(() => setWhatsStatus('NOT_CREATED'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enquanto o QR está na tela, sonda o status a cada 3s até o pareamento.
  useEffect(() => {
    if (!qrCode) return;
    const timer = setInterval(async () => {
      try {
        const data = await api<{ status: WhatsappStatus }>('/whatsapp/status');
        setWhatsStatus(data.status);
        if (data.status === 'CONNECTED') {
          setQrCode(null);
          setPairingCode(null);
          push('success', 'WhatsApp conectado! A sessão fica salva neste servidor.');
        }
      } catch {
        // transitório: continua sondando
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [qrCode, push]);

  async function connectWhatsApp() {
    setConnectLoading(true);
    try {
      const result = await api<WhatsappConnectResponse>('/whatsapp/connect', {
        method: 'POST'
      });
      if (result.connected) {
        setWhatsStatus('CONNECTED');
        setQrCode(null);
        setPairingCode(null);
        push('success', 'WhatsApp já está conectado.');
      } else {
        setQrCode(result.qrcode);
        setPairingCode(result.pairingCode);
        setWhatsStatus('CONNECTING');
      }
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setConnectLoading(false);
    }
  }

  async function disconnectWhatsApp() {
    setDisconnecting(true);
    try {
      await api('/whatsapp/disconnect', { method: 'POST' });
      setWhatsStatus('DISCONNECTED');
      setQrCode(null);
      setPairingCode(null);
      setDisconnectOpen(false);
      push('success', 'WhatsApp desconectado. Para voltar, leia um novo QR Code.');
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        gatewayProvider: gatewayProvider || null
      };
      // Semântica: `undefined` mantém o segredo salvo; string troca; null limpa.
      if (removeGatewayKey) payload.gatewayApiKey = null;
      else if (gatewayKeyInput) payload.gatewayApiKey = gatewayKeyInput;
      if (removeMpSecret) payload.mpWebhookSecret = null;
      else if (mpSecretInput) payload.mpWebhookSecret = mpSecretInput;

      const updated = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      hydrate(updated);
      push('success', 'Configurações salvas.');
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function rotateSecret() {
    setRotating(true);
    try {
      const updated = await api<Settings>('/settings/webhook-secret/rotate', {
        method: 'POST'
      });
      hydrate(updated);
      setRotateOpen(false);
      push('success', 'Novo segredo gerado. Atualize no painel do seu gateway.');
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setRotating(false);
    }
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    push('success', `${label} copiado!`);
  }

  if (!settings) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-sand-900">Configurações</h1>
          <p className="mt-1 text-[13px] text-sand-600">
            Chaves ficam criptografadas (AES-256-GCM) e nunca voltam inteiras para o navegador.
          </p>
        </div>
        <Button size="sm" onClick={save} loading={saving}>
          Salvar alterações
        </Button>
      </header>

      {/* Gateway */}
      <Card>
        <CardHeader
          title="Gateway de pagamento"
          subtitle="Quem gera o Pix dinâmico das suas cobranças."
        />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label="Provedor">
            <Select
              value={gatewayProvider}
              onChange={(event) =>
                setGatewayProvider(event.target.value as '' | 'ASAAS' | 'MERCADO_PAGO')
              }
            >
              <option value="">Nenhum (cobranças sem Pix)</option>
              <option value="ASAAS">Asaas</option>
              <option value="MERCADO_PAGO">Mercado Pago</option>
            </Select>
          </Field>
          <Field
            label="Chave de API"
            hint={
              settings.gatewayApiKeySet
                ? removeGatewayKey
                  ? 'A chave salva será REMOVIDA ao salvar.'
                  : 'Deixe em branco para manter a chave atual.'
                : 'Cole a chave do painel do provedor.'
            }
          >
            <Input
              type="password"
              value={gatewayKeyInput}
              onChange={(event) => {
                setGatewayKeyInput(event.target.value);
                setRemoveGatewayKey(false);
              }}
              placeholder={
                settings.gatewayApiKeySet
                  ? `Salva: ${settings.gatewayApiKeyMasked}`
                  : gatewayProvider === 'MERCADO_PAGO'
                    ? 'APP_USR-…'
                    : '$aact_…'
              }
              autoComplete="off"
            />
            {settings.gatewayApiKeySet && !gatewayKeyInput && (
              <button
                type="button"
                onClick={() => setRemoveGatewayKey((current) => !current)}
                className={cx(
                  'mt-1.5 text-xs underline underline-offset-2',
                  removeGatewayKey ? 'text-sand-500' : 'text-danger-600'
                )}
              >
                {removeGatewayKey ? 'Manter chave salva' : 'Remover chave salva'}
              </button>
            )}
          </Field>
          {gatewayProvider === 'MERCADO_PAGO' && (
            <Field
              label="Assinatura secreta do webhook (Mercado Pago)"
              hint={
                settings.mpWebhookSecretSet
                  ? removeMpSecret
                    ? 'A assinatura salva será REMOVIDA ao salvar.'
                    : 'Deixe em branco para manter a assinatura atual.'
                  : 'No painel do MP: Suas integrações → Webhooks → Assinatura secreta. É com ela que validamos o header x-signature.'
              }
            >
              <Input
                type="password"
                value={mpSecretInput}
                onChange={(event) => {
                  setMpSecretInput(event.target.value);
                  setRemoveMpSecret(false);
                }}
                placeholder={
                  settings.mpWebhookSecretSet
                    ? `Salva: ${settings.mpWebhookSecretMasked}`
                    : 'Cole a assinatura secreta do painel do MP'
                }
                autoComplete="off"
              />
              {settings.mpWebhookSecretSet && !mpSecretInput && (
                <button
                  type="button"
                  onClick={() => setRemoveMpSecret((current) => !current)}
                  className={cx(
                    'mt-1.5 text-xs underline underline-offset-2',
                    removeMpSecret ? 'text-sand-500' : 'text-danger-600'
                  )}
                >
                  {removeMpSecret ? 'Manter assinatura salva' : 'Remover assinatura salva'}
                </button>
              )}
            </Field>
          )}
        </div>
      </Card>

      {/* WhatsApp */}
      <Card>
        <CardHeader
          title="WhatsApp"
          subtitle="Conecte lendo o QR Code — a sessão fica salva e as mensagens saem SEMPRE do seu próprio número."
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cx(
                  'h-2.5 w-2.5 rounded-full',
                  whatsStatus === 'CONNECTED'
                    ? 'bg-leaf-500'
                    : whatsStatus === 'CONNECTING'
                      ? 'bg-flame-400'
                      : whatsStatus === 'LOADING'
                        ? 'bg-sand-300'
                        : 'bg-danger-500'
                )}
              />
              <span className="font-semibold text-sand-700">
                {whatsStatus === 'CONNECTED' && 'Conectado — cobranças serão enviadas pelo seu WhatsApp.'}
                {whatsStatus === 'CONNECTING' && 'Aguardando leitura do QR Code…'}
                {whatsStatus === 'DISCONNECTED' && 'Desconectado — leia um novo QR Code para reativar.'}
                {whatsStatus === 'NOT_CREATED' && 'Nenhum WhatsApp conectado ainda.'}
                {whatsStatus === 'LOADING' && 'Verificando conexão…'}
              </span>
            </div>
            <div className="flex gap-2">
              {whatsStatus === 'CONNECTED' ? (
                <Button variant="outline" onClick={() => setDisconnectOpen(true)}>
                  <Unplug className="h-4 w-4" /> Desconectar
                </Button>
              ) : (
                <Button
                  onClick={connectWhatsApp}
                  loading={connectLoading}
                  disabled={whatsStatus === 'LOADING'}
                >
                  <QrCode className="h-4 w-4" />
                  {qrCode ? 'Gerar novo QR Code' : 'Conectar com QR Code'}
                </Button>
              )}
            </div>
          </div>

          {qrCode && whatsStatus !== 'CONNECTED' && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-sand-200 bg-sand-50 p-6 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="QR Code para conectar o WhatsApp"
                className="h-52 w-52 rounded-xl bg-white p-2 shadow-card"
              />
              <div className="space-y-2 text-sm leading-relaxed text-sand-600">
                <p className="font-bold text-sand-900">Como conectar:</p>
                <ol className="list-inside list-decimal space-y-1">
                  <li>Abra o WhatsApp no seu celular</li>
                  <li>
                    Toque em <span className="font-semibold">Aparelhos conectados</span> →{' '}
                    <span className="font-semibold">Conectar aparelho</span>
                  </li>
                  <li>Aponte a câmera para o QR Code ao lado</li>
                </ol>
                <p className="text-xs text-sand-500">
                  O código expira em cerca de 1 minuto — se passar, clique em
                  &ldquo;Gerar novo QR Code&rdquo;. Depois de conectar uma vez, a sessão
                  fica salva e não é preciso escanear de novo.
                </p>
                {pairingCode && (
                  <p className="text-xs text-sand-500">
                    Código de pareamento alternativo:{' '}
                    <code className="font-mono font-bold">{pairingCode}</code>
                  </p>
                )}
              </div>
            </div>
          )}

          <p className="rounded-xl bg-sand-50 px-3 py-2.5 text-xs leading-relaxed text-sand-600">
            🔒 Cada conta tem a sua própria instância de WhatsApp, criada e isolada pelo
            servidor. Não é possível usar o número de outra pessoa: o QR Code exibido aqui
            conecta exclusivamente a sua conta.
          </p>
        </div>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader
          title="Webhook de pagamento"
          subtitle="Cole a URL e o token no painel do gateway — é assim que a baixa vira tempo real."
        />
        <div className="space-y-4 p-5">
          <Field label="URL do webhook">
            <div className="flex flex-wrap gap-2">
              <Input
                readOnly
                value={settings.webhookUrl}
                className="min-w-0 flex-1 basis-56 font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={() => copy(settings.webhookUrl, 'URL do webhook')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </Field>
          <Field
            label="Token secreto"
            hint="No Asaas: Integrações → Webhooks → Token de autenticação. No Mercado Pago este token não é usado — lá basta cadastrar a URL e colar a Assinatura secreta no campo acima. Em testes manuais, envie no header x-webhook-token (ou ?token=)."
          >
            <div className="flex flex-wrap gap-2">
              <Input
                readOnly
                value={settings.webhookSecret}
                className="min-w-0 flex-1 basis-56 font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={() => copy(settings.webhookSecret, 'Token do webhook')}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => setRotateOpen(true)}>
                <RefreshCw className="h-4 w-4" /> Gerar novo
              </Button>
            </div>
          </Field>
          <p className="flex items-start gap-2 rounded-xl bg-sand-50 px-3 py-2.5 text-xs leading-relaxed text-sand-600">
            <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
            Quando o gateway confirma um Pix, esta URL marca a fatura como paga, atualiza o
            painel em tempo real e dispara a confirmação no WhatsApp do cliente.
          </p>

          <WebhookTutorial />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          <KeyRound className="h-4 w-4" /> Salvar alterações
        </Button>
      </div>

      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={rotateSecret}
        loading={rotating}
        title="Gerar um novo segredo?"
        confirmLabel="Gerar novo segredo"
        description="O token atual deixa de funcionar imediatamente. Lembre de atualizar a configuração de webhook no painel do seu gateway."
      />

      <ConfirmDialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={disconnectWhatsApp}
        loading={disconnecting}
        title="Desconectar o WhatsApp?"
        confirmLabel="Desconectar"
        description="As cobranças param de ser enviadas até você conectar de novo lendo um novo QR Code no seu celular."
      />
    </div>
  );
}
