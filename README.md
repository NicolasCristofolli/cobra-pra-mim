# Cobra pra mim 🐍💸

SaaS B2B de **cobranças recorrentes via Pix + WhatsApp** para pequenos negócios brasileiros. Cadastre clientes, crie faturas avulsas ou recorrentes e deixe o motor trabalhar: todo dia ele gera o Pix no gateway, envia a mensagem de cobrança no WhatsApp, marca atrasos e materializa o próximo ciclo da série. Quando o cliente paga, o webhook do gateway marca a fatura como paga, o dashboard atualiza em tempo real e o cliente recebe a confirmação no WhatsApp.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend | Next.js 14 (App Router) · React 18 · Tailwind CSS · Recharts · Lucide |
| Backend | Node.js 22 · TypeScript (strict) · Express · Zod · node-cron |
| Banco | PostgreSQL 16 · SQL puro via `pg` (node-postgres) |
| Segurança | JWT em cookie httpOnly · bcrypt · AES-256-GCM · helmet · rate limit |
| Testes | Vitest + Supertest — **36 testes de integração reais** (banco de verdade, HTTP de verdade) |
| Integrações | Asaas · Mercado Pago · Evolution API · Z-API |

## Funcionalidades ↔ requisitos

- **Login/Registro** — JWT assinado, entregue em cookie `httpOnly` + `SameSite=Lax` (nunca em `localStorage`).
- **Dashboard** — Total Faturado, Taxa de Inadimplência, Faturas Ativas, Lucro Líquido (valor líquido pós-taxas do gateway), **MRR** e **Projeção 30 dias** (faturas em aberto + ocorrências futuras das séries recorrentes). Gráfico de fluxo de caixa *Recebido vs Pendente* e lista "vencendo hoje" com envio imediato. **Tempo real** via Server-Sent Events: o webhook publica o pagamento e o dashboard recarrega sozinho.
- **Clientes** — CRUD completo. **Duplicidade é regra de negócio**: dois clientes podem ter o mesmo nome e/ou o mesmo telefone; a identidade é o UUID. Status derivado das faturas: *Adimplente*, *Inadimplente* (tem atrasada), *Sem cobranças ativas*. Exclusão com histórico devolve `409` amigável (o histórico financeiro é preservado).
- **Histórico de Cobranças** — filtros por nome e status (*Paga*, *Pendente*, *Atrasada*, *Cancelada*), ações de copiar Pix, enviar agora, marcar paga manualmente e cancelar (cancelar a última fatura encerra a série recorrente).
- **Configurações** — chaves do gateway (Asaas/Mercado Pago) e do WhatsApp (Evolution/Z-API, incluindo o `Client-Token` da Z-API) criptografadas com **AES-256-GCM** em repouso; URL + segredo do webhook com rotação; templates de mensagem com variáveis e pré-visualização.
- **Motor diário (CRON)** — idempotente: (1) materializa os próximos ciclos das séries (com *catch-up* se o servidor ficou dias fora do ar), (2) marca atrasadas, (3) gera Pix dinâmico e envia a cobrança de tudo que vence hoje + atrasadas nunca avisadas. Falha de gateway **não** dispara mensagem sem Pix; falha de envio fica auditada em `notification_logs` e é reenviada no ciclo seguinte.
- **Webhook público** `POST /webhooks/payments/:userId` — exige o token secreto (header `asaas-access-token`, `x-webhook-token` ou `?token=`), comparado em **tempo constante**. Aceita payload do Asaas, do Mercado Pago (com verificação ativa na API antes de confiar) e um formato genérico para testes manuais. Idempotente: replay do evento responde `alreadyPaid`.

## Rodando o projeto

Pré-requisitos: Node 20+, Docker (para o Postgres) — ou um Postgres 16 local.

```bash
# 1) Banco
docker compose up -d db          # cria os bancos cobra e cobra_test

# 2) Backend
cd backend
cp .env.example .env             # gere ENCRYPTION_KEY: openssl rand -base64 32
npm install
npm run migrate && npm run seed  # conta demo pronta
npm run dev                      # http://localhost:4000

# 3) Frontend (outro terminal)
cd frontend
npm install
npm run dev                      # http://localhost:3000
```

**Conta demo (seed):** `demo@cobrapramim.com` / `cobra123` — vem com clientes homônimos, telefone compartilhado, faturas em todos os status e uma série mensal vencendo hoje. Segredo do webhook demo: `demo-webhook-secret-2f8a1c`.

Simule um pagamento sem gateway (formato genérico):

```bash
curl -X POST "http://localhost:4000/webhooks/payments/<USER_ID>" \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-token: demo-webhook-secret-2f8a1c' \
  -d '{"status":"PAID","chargeId":"<CHARGE_ID>","netAmountCents":14802}'
```

`USER_ID` e a URL completa aparecem em **Configurações → Webhook**; o `CHARGE_ID` em qualquer fatura do Histórico.

## Configurando produção de verdade

1. **Gateway** — cole a API key do Asaas (produção ou sandbox `$aact_hmlg…`, detectado automaticamente) ou o Access Token do Mercado Pago em *Configurações → Gateway*.
2. **Webhook** — no painel do gateway, cadastre a URL exibida em *Configurações → Webhook* e configure o token de autenticação com o segredo mostrado (no Asaas: *Integrações → Webhooks → Token de autenticação*; no Mercado Pago use `?token=SEGREDO` na URL). O botão *Gerar novo segredo* rotaciona a credencial.
3. **WhatsApp** — Evolution API: URL base da sua instância, nome da instância e API key. Z-API: ID da instância, token da instância e o **Client-Token** da conta.
4. **Templates** — personalize com `{nome_cliente}`, `{valor}`, `{data_vencimento}`, `{descricao}` e `{link_pix}` (copia-e-cola; cai para o link da fatura se o Pix não existir).

## Variáveis de ambiente (backend)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | ✔ | ex.: `postgresql://cobra:cobra@localhost:5432/cobra` |
| `JWT_SECRET` | ✔ | segredo do token de sessão |
| `ENCRYPTION_KEY` | ✔ | **32 bytes em base64** (`openssl rand -base64 32`) — cifra chaves e segredos em repouso |
| `PORT` | | padrão `4000` |
| `APP_URL` | | URL pública da API (compõe a URL do webhook) |
| `FRONTEND_ORIGIN` | | origem liberada no CORS (padrão `http://localhost:3000`) |
| `APP_TZ` | | fuso do negócio (padrão `America/Sao_Paulo`) |
| `CRON_SCHEDULE` | | padrão `0 8 * * *` (08:00) |
| `DISABLE_CRON` | | `true` desliga o agendador (útil em dev/testes) |

Frontend: `API_PROXY_TARGET` (padrão `http://localhost:4000`) — o Next reescreve `/api/*` para a API, então o cookie viaja **same-origin**, sem CORS cross-site.

## Testes

```bash
cd backend
npm test        # exige o banco cobra_test (docker compose já cria)
```

36 testes em 6 suítes, todos contra Postgres e HTTP reais (gateway/WhatsApp são fakes injetados que capturam cada chamada — nenhum teste toca a internet):

- **Webhook seguro** — sem token e token errado ⇒ `401` e a fatura não muda; token válido paga, grava líquido, confirma no WhatsApp e loga; replay é idempotente; evento sem correspondência responde `200`; token válido de outro usuário não paga fatura alheia.
- **Identidades duplicadas** — dois clientes com mesmo nome+telefone convivem; duas cobranças para o mesmo cliente; clientes diferentes compartilhando telefone.
- **Anti-IDOR** — leitura/edição/exclusão cross-tenant devolvem `404`; criar cobrança apontando cliente alheio: `404`.
- **Motor** — ciclo completo (Pix + mensagem + próximo ciclo), atraso + notificação, idempotência na re-execução, *catch-up* de 3 meses com cadeia íntegra, retry após falha transitória, usuário sem settings não derruba o ciclo.
- **Recorrência** — âncora dia 31 por fevereiro (bissexto e comum), semanal cruzando ano, anual 29/fev, projeção de ocorrências por janela.
- **Criptografia** — roundtrip, IVs únicos, detecção de adulteração (GCM), comparação em tempo constante.

## Segurança

Cookie `httpOnly`+`SameSite` (imune a leitura por XSS) · senhas com bcrypt · login com rate-limit e resposta única anti-enumeração · segredos e chaves de API cifrados com AES-256-GCM (payload versionado `v1.iv.tag.ct`) · token do webhook comparado com `timingSafeEqual` · todo acesso a dados escopado por `user_id` (IDOR ⇒ `404`) · validação de entrada com Zod em todas as rotas · helmet · erros de banco mapeados para respostas amigáveis sem vazar SQL.

## Decisões de arquitetura

- **SQL puro (`pg`) em vez de Prisma** — o schema é pequeno e as consultas do dashboard (agregações com `FILTER`, `DISTINCT ON`, `generate_series`) ficam melhores em SQL nativo; zero passo de codegen. *(Nota de build: o download dos binários do Prisma também não é permitido no ambiente de empacotamento deste projeto.)*
- **Dinheiro em centavos `INTEGER`** — aritmética exata; formatação BRL só na borda.
- **`DATE` como string `YYYY-MM-DD`** (parser do `pg` configurado) — vencimento é conceito de calendário; nada de bugs de fuso em meia-noite UTC.
- **Recorrência com `series_id` + `anchor_day` + `UNIQUE(series_id, due_date)` + flag `next_generated`** — dia 31 sobrevive a fevereiro e **volta** ao 31; o motor pode rodar N vezes (ou dias atrasado) sem duplicar nem furar ciclo, garantido pelo próprio banco.
- **node-cron em processo, sem fila** — um job diário leve não justifica Redis/BullMQ no MVP; a interface `AppDeps` já isola o I/O externo, então promover o envio para uma fila depois não toca a regra de negócio.
- **Webhook responde `200` para eventos não mapeados** — evita tempestade de retries do gateway e não revela nada sobre a base; segurança fica no token, não na obscuridade.

## Estrutura

```
backend/
  db/migrations/           # SQL versionado (runner próprio em src/db/migrate.ts)
  src/
    lib/                   # crypto (AES-GCM), datas/recorrência, template, BRL, SSE
    middleware/            # auth (JWT cookie), error handler (Zod/Postgres → HTTP)
    modules/               # auth, clients, charges, settings, webhooks, dashboard
    services/              # deps (portas), gateway/{asaas,mercado-pago}, whatsapp/{evolution,zapi}, billing-engine
  tests/                   # 36 testes de integração + fakes injetáveis
frontend/
  src/app/                 # login, dashboard, clientes, cobranças, configurações
  src/components/          # ui kit, sidebar, toasts, gráfico de fluxo de caixa
```

## Limitações conhecidas / roadmap

R�guas de cobrança multi-etapa (D-3, D0, D+3), fila com retry exponencial para envios, verificação de assinatura HMAC específica por gateway além do token, paginação/busca server-side nos logs de notificação, multiusuário por conta (times) e testes E2E de UI (Playwright).
