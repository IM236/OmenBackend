# Market Backend

Backend service for issuing tokenized real-world asset (RWA) markets, managing approval workflows, deploying Sapphire ERC-20 tokens, and operating a secondary trading venue. The codebase wraps a production-style Express + TypeScript stack with layered services, event-driven integrations, and BullMQ powered background workers.

## Core Capabilities
- **RWA lifecycle orchestration** – issuer registration, compliance approvals, async token deployment, activation, pause/archive flows.
- **Entity Permissions Core integration** – RBAC enforcement, webhook/polling approval decisions, audit trail persistence.
- **Sapphire blockchain connectivity** – confidential signer bootstrap, rate-limited RPC, token deployment & transaction queueing.
- **Trading & settlement engine** – signature-verified orders, in-memory matching, ACID trade settlement, analytics feeds.
- **Token & balance management** – mint/transfer queues, compliance gating, balance locking, wrapping/unwrapping into USDC.
- **Operational guardrails** – structured logging, correlation IDs, rate limiting, Zod validation, graceful shutdown.

## Architecture at a Glance
- **Layered Express app** (`controllers → services → infra/clients`) with dependency factories and shared types.
- **Persistence** – PostgreSQL (markets, trading, audit, processed events) and Redis (caching, BullMQ job store).
- **Event broker** – `marketEventBroker` persists lifecycle events and emits hooks for approvals/activations.
- **Approval flow** – asynchronous via `/api/v1/webhooks/entity-permissions` or polling Entity Permissions Core every 10s; idempotency guaranteed by `processed_events`.
- **Background workers** – initialized during bootstrap for token deployment, settlement, reconciliation, transaction processing, and order matching.
- **Documentation** – deeper specs in `ARCHITECTURE.md`, `IMPLEMENTATION_SUMMARY.md`, `ASYNC_APPROVAL_IMPLEMENTATION.md`, and `TRADING_SYSTEM_IMPLEMENTATION.md`.

## RWA Lifecycle Workflow
1. **Register** – `POST /api/v1/markets/register` (issuer role) creates market + asset records, publishes `market.registered`.
2. **Approval requested** – service updates status to `pending_approval` and emits `market.approval_requested`.
3. **Decision intake** – Entity Permissions Core posts to webhook or is polled; `market.approved` or `market.rejected` recorded with full audit trail.
4. **Async activation** – approvals enqueue BullMQ `deploy-token` jobs; worker deploys Sapphire ERC-20, updates contract details, emits `market.activated`.
5. **Operations** – admins may pause, archive, or re-trigger activation; `/markets/:id/events` exposes chronological lifecycle history.

## Trading & Tokenization Workflows
- **Order submission** – signed orders validated via EIP-712, nonce tracking, and compliance checks before enqueueing `order-matching` jobs.
- **Matching & settlement** – matching worker prioritizes market orders, records trades, locks/unlocks balances, and hands off to `execute-blockchain-settlement`.
- **Token service** – CRUD, minting, transfers, compliance updates, and caching; BullMQ queues (`mint-token`, `process-transfer`, `process-withdrawal`, etc.) handle side effects.
- **Wrapper service** – wrap/unwrap RWA tokens into USDC with queued processing and cached quotes.

## API Surface
| Domain | Method & Route | Purpose |
| --- | --- | --- |
| Markets | `POST /markets/register` | Register RWA market |
|  | `POST /markets/:id/approve` | Approve or reject (admin) |
|  | `POST /markets/:id/activate` | Trigger token deployment |
|  | `POST /markets/:id/pause` / `archive` | Operational controls |
|  | `GET /markets` / `:id` / `:id/details` | Market queries |
|  | `GET /markets/:id/events` | Lifecycle audit trail |
| Webhooks | `POST /webhooks/entity-permissions` | Ingest approval decisions |
| Trading | `POST /trading/orders` | Submit signed order |
|  | `DELETE /trading/orders/:orderId` | Cancel order |
|  | `GET /trading/orders/:orderId` | Order detail |
|  | `GET /trading/users/:userId/orders` | User order history |
|  | `GET /trading/pairs` / `:pairId/orderbook` / `:pairId/stats` | Market data |
| Tokens | `POST /tokens` / `GET /tokens` | Manage token metadata |
|  | `POST /tokens/:tokenId/mint` / `transfer` | Blockchain-side ops |
| Wrapper | `POST /wrapper/quotes` / `wrap` / `unwrap` | Wrap/unwrap orchestration |
| Health | `GET /health` | Liveness & readiness (via `healthRouter`) |

## Background Queues & Workers
- `deploy-token` – Sapphire ERC-20 deployment for approved markets.
- `market-tx-queue` & DLQ – Sapphire transaction submission + retry management.
- `order-matching` – In-memory order matching orchestrator with priority handling.
- `execute-blockchain-settlement`, `blockchain-reconciliation` – Post-trade settlement & ledger sync.
- `mint-token`, `process-transfer`, `process-withdrawal` – Token lifecycle operations.
- `verify-compliance`, `send-trade-notification`, `update-market-stats`, `fetch-external-prices`, `aggregate-candles`, `update-token-metadata` – Supporting compliance, comms, and analytics.
- Workers boot during `bootstrapInfrastructure` and share Redis-backed BullMQ connections; concurrency is configured via env.

## Project Layout
```
src/
├── app.ts                     # Express wiring & middleware registration
├── server.ts                  # Bootstrap + graceful shutdown
├── clients/                   # External APIs (Entity Permissions, Sapphire, etc.)
├── config/                    # Zod-validated environment configuration
├── controllers/               # HTTP handlers (markets, trading, tokens, wrapper, webhooks)
├── infra/
│   ├── database/              # Knex/pg setup, migrations, repositories
│   ├── eventBroker/           # Market lifecycle broker
│   ├── queue/                 # BullMQ queues + workers
│   ├── redis/                 # Redis bootstrap
│   ├── sapphire/              # Sapphire RPC + signer bootstrap
│   └── events/                # Polling listeners (Entity Permissions, Sapphire)
├── lib/                       # Cross-cutting helpers (async handler, errors, cache, signatures)
├── middlewares/               # Auth, validation, correlation IDs, rate limiting, errors
├── routes/                    # Express routers per domain
├── services/                  # Business logic (market, trading, token, wrapper, settlement, etc.)
├── tests/                     # Vitest scaffolding for unit/integration tests
└── types/                     # Shared domain typings (market, trading, token, wrapper, auth)
```

## Getting Started
1. **Prerequisites** – Node 18.18+, PostgreSQL 14+, Redis 6+, and access to a Sapphire RPC endpoint (or mocked client).
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure environment** – copy `.env.example` to `.env` and fill in database, Redis, Entity Permissions, and Sapphire credentials (mnemonic or confidential signer key). Either `ADMIN_API_KEY` or `ADMIN_JWT_PUBLIC_KEY` is required for admin auth.
4. **Run database migrations**
   ```bash
   npm run migrate
   ```
5. **Start the service**
   ```bash
   npm run dev      # hot reload with tsx
   # or
   npm run build && npm start
   ```
   The bootstrap process initialises DB, Redis, queues, Sapphire client, event listeners, and background workers before exposing HTTP on `PORT`.

## Configuration
Key environment variables (see `.env.example` for full list):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection for BullMQ + caching |
| `ENTITY_PERMISSIONS_BASE_URL` / `ENTITY_PERMISSIONS_API_KEY` | Entity Permissions Core endpoint & auth |
| `SAPPHIRE_RPC_URL`, `SAPPHIRE_CHAIN_ID` | Sapphire network configuration |
| `OASIS_WALLET_MNEMONIC` \| `CONFIDENTIAL_SIGNER_PRIVATE_KEY` | Confidential signer for Sapphire transactions |
| `TRANSACTION_QUEUE_NAME`, `DLQ_QUEUE_NAME` | Primary BullMQ queue names |
| `MAX_RETRY_ATTEMPTS`, `RETRY_BACKOFF_MS`, `WORKER_CONCURRENCY` | Queue retry tuning |
| `ADMIN_API_KEY` \| `ADMIN_JWT_PUBLIC_KEY` | Admin authentication mechanism |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | API rate limiting window |
| `ENABLE_WEBSOCKETS` | Toggle for future realtime transports |

## Scripts
- `npm run dev` – Start development server with hot reload.
- `npm run build` – Compile TypeScript to `dist/`.
- `npm start` – Run compiled server.
- `npm run migrate` – Execute database migrations.
- `npm run test` / `npm run test:integration` – Execute Vitest suites (currently scaffolded).
- `npm run lint` – Type-check via `tsc --noEmit`.

## Testing & Observability
- Logging via Pino + correlation IDs; configurable log level with `LOG_LEVEL`.
- Vitest suites (`src/tests`) contain unit/integration scaffolds with TODO markers for high-priority coverage.
- Queue & worker metrics can be inspected via BullMQ events/logging; reconciliation jobs log progress in `marketEventBroker`.

## Further Reading
- `ARCHITECTURE.md` – System diagrams, lifecycle detail, integration contracts.
- `IMPLEMENTATION_SUMMARY.md` – End-to-end feature breakdown, outstanding work, API checklists.
- `ASYNC_APPROVAL_IMPLEMENTATION.md` – Deep dive on new approval pipeline.
- `TRADING_SYSTEM_IMPLEMENTATION.md` / `RWA_TRADING_INTEGRATION.md` – Trading and RWA/token integration specifics.

