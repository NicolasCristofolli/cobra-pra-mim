# Graph Report - cobra-pra-mim  (2026-07-16)

## Corpus Check
- 79 files · ~32,153 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 492 nodes · 1063 edges · 71 communities (19 shown, 52 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Frontend Feature Pages
- App Bootstrap & DB Pool
- Architecture & Infra Docs
- billing-engine.ts
- Backend Dependencies
- Charges Repo & Event Bus
- Frontend Dependencies
- Frontend TS Config
- Backend TS Config
- Payment Gateway Integrations
- WhatsApp Provider Integrations
- Root Layout
- Next.js Config
- Next Env Types
- Tailwind Config
- Cobra pra mim 🐍💸
- CLAUDE.md
- AES-256-GCM
- AppDeps (interface de portas de I/O externo)
- Asaas
- backend/
- bcrypt
- services/billing-engine
- Clientes (CRUD)
- Configurações
- Dashboard
- DATABASE_URL
- DATE como string YYYY-MM-DD
- Dinheiro em centavos INTEGER
- ENCRYPTION_KEY
- Evolution API
- Express
- frontend/
- helmet
- Histórico de Cobranças
- JWT em cookie httpOnly
- Login/Registro
- Lucide
- Mercado Pago
- src/db/migrate.ts (runner de migrations)
- Motor diário (CRON)
- Next.js 14 (App Router)
- node-cron
- node-cron em processo, sem fila
- Node.js 22
- notification_logs
- pg (node-postgres)
- Pix
- rate limit
- React 18
- Recharts
- Recorrência com series_id + anchor_day + UNIQUE(series_id, due_date) + next_generated
- SQL puro (pg) em vez de Prisma
- Server-Sent Events (tempo real)
- Supertest
- Tailwind CSS
- 36 testes de integração (6 suítes)
- TypeScript (strict)
- Vitest
- Webhook responde 200 para eventos não mapeados
- Webhook público POST /webhooks/payments/:userId
- WhatsApp
- Z-API
- Zod
- page.tsx
- page.tsx
- sidebar.tsx

## God Nodes (most connected - your core abstractions)
1. `query()` - 24 edges
2. `cx()` - 22 edges
3. `queryOne()` - 19 edges
4. `chargesRouter()` - 17 edges
5. `api()` - 15 edges
6. `compilerOptions` - 15 edges
7. `webhooksRouter()` - 14 edges
8. `compilerOptions` - 14 edges
9. `encrypt()` - 13 edges
10. `AppDeps` - 13 edges

## Surprising Connections (you probably didn't know these)
- `runMigrations()` --references--> `Client`  [EXTRACTED]
  backend/src/db/migrate.ts → frontend/src/lib/types.ts
- `createApp()` --indirect_call--> `requireAuth()`  [INFERRED]
  backend/src/app.ts → backend/src/middleware/auth.ts
- `createApp()` --indirect_call--> `errorHandler()`  [INFERRED]
  backend/src/app.ts → backend/src/middleware/error-handler.ts
- `findUsers()` --calls--> `query()`  [EXTRACTED]
  backend/src/modules/auth/auth.routes.ts → backend/src/db/index.ts
- `chargesRouter()` --indirect_call--> `requireAuth()`  [INFERRED]
  backend/src/modules/charges/charges.routes.ts → backend/src/middleware/auth.ts

## Import Cycles
- None detected.

## Communities (71 total, 52 thin omitted)

### Community 0 - "Frontend Feature Pages"
Cohesion: 0.10
Nodes (34): ClientForm, EMPTY_FORM, STATUS_FILTERS, ConfiguracoesPage(), TRUST_BADGES, VALUE_PROPS, AVATAR_PALETTE, Badge() (+26 more)

### Community 1 - "App Bootstrap & DB Pool"
Cohesion: 0.14
Nodes (13): SettingsRow, AppDeps, defaultDeps, AsaasGateway, buildGatewayAdapter(), MercadoPagoGateway, CreatePixChargeInput, CreatePixChargeResult (+5 more)

### Community 2 - "Architecture & Infra Docs"
Cohesion: 0.50
Nodes (3): cobra_pgdata volume, db service (postgres:16-alpine), PostgreSQL 16

### Community 3 - "billing-engine.ts"
Cohesion: 0.33
Nodes (6): NAV, NavItem(), Sidebar(), Avatar(), initialsOf(), Settings

### Community 4 - "Backend Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, bcryptjs, cookie-parser, cors, dotenv, express, express-rate-limit, helmet (+31 more)

### Community 5 - "Charges Repo & Event Bus"
Cohesion: 0.07
Nodes (62): env, closePool(), getPool(), query(), queryOne(), withTransaction(), runMigrations(), seed() (+54 more)

### Community 6 - "Frontend Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, lucide-react, next, react, react-dom, recharts, devDependencies, autoprefixer (+13 more)

### Community 7 - "Frontend TS Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 8 - "Backend TS Config"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noUncheckedIndexedAccess, outDir (+8 more)

### Community 9 - "Payment Gateway Integrations"
Cohesion: 0.13
Nodes (26): createApp(), decrypt(), encrypt(), maskSecret(), masterKey(), safeEqual(), publish(), findChargeForWebhook() (+18 more)

### Community 10 - "WhatsApp Provider Integrations"
Cohesion: 0.08
Nodes (39): AppError, asyncHandler, notFound(), unauthorized(), DEFAULT_CHARGE_TEMPLATE, clearAuthCookie(), Express, Request (+31 more)

### Community 20 - "Cobra pra mim 🐍💸"
Cohesion: 0.17
Nodes (11): Cobra pra mim 🐍💸, Configurando produção de verdade, Decisões de arquitetura, Estrutura, Funcionalidades ↔ requisitos, Limitações conhecidas / roadmap, Rodando o projeto, Segurança (+3 more)

### Community 69 - "page.tsx"
Cohesion: 0.12
Nodes (21): ClientTotals, DashboardPage(), greeting(), percent(), StatusTotals, CashflowChart(), DONUT_COLOR, DonutChart() (+13 more)

### Community 70 - "page.tsx"
Cohesion: 0.17
Nodes (19): ClientesContent(), CobrancasContent(), STATUS_FILTERS, todayInput(), MensagensPage(), renderPreview(), TEMPLATE_VARS, ChartTooltip() (+11 more)

### Community 72 - "sidebar.tsx"
Cohesion: 0.15
Nodes (14): AppLayout(), ICON, ToastContext, ToastItem, ToastProvider(), ToastType, Topbar(), ClientBadge() (+6 more)

## Knowledge Gaps
- **203 isolated node(s):** `name`, `version`, `private`, `description`, `type` (+198 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **52 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runMigrations()` connect `Charges Repo & Event Bus` to `Frontend Feature Pages`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `Client` connect `Frontend Feature Pages` to `sidebar.tsx`, `page.tsx`, `Charges Repo & Event Bus`, `page.tsx`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `start()` connect `Charges Repo & Event Bus` to `Payment Gateway Integrations`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `chargesRouter()` (e.g. with `requireAuth()` and `serializeCharge()`) actually correct?**
  _`chargesRouter()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _212 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend Feature Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.09615384615384616 - nodes in this community are weakly interconnected._
- **Should `App Bootstrap & DB Pool` be split into smaller, more focused modules?**
  _Cohesion score 0.13548387096774195 - nodes in this community are weakly interconnected._