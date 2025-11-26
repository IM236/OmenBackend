# Market Backend (Skeleton)

Express + TypeScript skeleton for the Omen market management service. The codebase establishes the core layering, infrastructure wiring, and placeholders for Sapphire transactions so feature work can begin immediately.

## Key Capabilities

- Strict TypeScript configuration with path aliases
- Layered architecture (`controllers → services → clients → infra`)
- PostgreSQL connection pooling with migration harness
- Redis connectivity + BullMQ queues (transaction & DLQ)
- Sapphire SDK bootstrap with confidential signer placeholders
- Rate-limited Sapphire RPC client with retry/backoff
- Transaction Manager scaffolding (pending/in_progress/confirmed/failed/dropped)
- Event listener skeleton for Sapphire market registry events
- Structured logging (Pino) with correlation IDs
- Zod-backed request validation and admin auth middleware
- Vitest test harness with unit & integration test stubs

## Directory Layout

```
marketBackend/
├── src/
│   ├── app.ts                   # Express wiring & middleware
│   ├── server.ts                # Service bootstrap + graceful shutdown
│   ├── config/                  # Zod env parsing + typed config
│   ├── controllers/             # HTTP controllers
│   ├── services/                # Domain services (market, tx manager, events, gas)
│   ├── clients/                 # External service/Sapphire clients
│   ├── infra/                   # Database, Redis, queues, logging, Sapphire bootstrap
│   ├── middlewares/             # Correlation IDs, auth, rate limiting, validation, errors
│   ├── routes/                  # Express routers
│   ├── lib/                     # Cross-cutting helpers (async handler, errors, rate limiter)
│   ├── types/                   # Shared type declarations
│   └── tests/                   # Vitest unit + integration scaffolds
├── tsconfig.json                # Strict TS config with path aliases
├── tsconfig.build.json          # Build-only config (emit to dist/)
├── vitest.config.ts             # Testing config
└── .env.example                 # Reference environment variables
```

## Getting Started

1. **Install dependencies**
   ```bash
   cd marketBackend
   npm install
   ```

2. **Copy `.env.example` to `.env`** and fill in:
   - Postgres connection (`DATABASE_URL`)
   - Redis endpoint (`REDIS_URL`)
   - Entity Permissions Core endpoint + API key
   - Sapphire RPC endpoint, chain id, and confidential signer credentials (mnemonic or private key)
   - Admin auth secret (`ADMIN_API_KEY` or `ADMIN_JWT_PUBLIC_KEY`)

3. **Run database migrations**
   ```bash
   npm run migrate
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Execute tests**
   ```bash
   npm run test
   # or focus on future integration tests
   npm run test:integration
   ```

## Infrastructure Overview

| Component          | Responsibility                                                                  |
|--------------------|----------------------------------------------------------------------------------|
| PostgreSQL         | Persists markets, transaction lifecycle (`transactions`), `market_events` ledger |
| Redis              | Backing store for BullMQ queues and future caching                               |
| BullMQ             | Manages Sapphire transaction queue + DLQ with exponential backoff                |
| Sapphire Provider  | Bootstraps confidential client & signer (Oasis SDK stubs)                        |
| Entity Permissions | Authorization guard via `/api/v1/authorize` for admin flows                     |
| Pino               | Structured logging with correlation IDs                                          |

## Entity Permissions Core Integration

The service depends on the existing Entity Permissions Core (EPR) for access control:

- **Authorization Flow**: `controllers/marketController` delegates to `MarketService`, which calls `EntityPermissionsClient.authorize`. This POSTs to `EPR /api/v1/authorize` with the acting admin, `entity_id`, and action (e.g. `market.register`, `market.approve`). Denials bubble up as HTTP 403.
- **Roles & Role Assignments**: Ensure the EPR schema (`database_schema.sql`) contains roles and permissions that cover the new actions. Recommended additions:
  - `permissions.action`: `market.register`, `market.approve`, `market.reject`, `market.pause`, `market.activate`
  - `roles`: Create administrative roles with appropriate `scope_types` (`['issuer', 'offering']` etc.)
  - `role_assignments`: Grant roles to admin principals managing the markets you create here.
- **Audit & Platform Events**: EPR already writes audit logs (`audit_logs`) and `platform_events`. When this service performs admin actions it logs them via Pino. You can forward these logs or hook into EPR's audit pipeline by POSTing to `/api/v1/events` if a cross-service audit is required.
- **Service Authentication**: Configure `ENTITY_PERMISSIONS_API_KEY` to match the API gateway/API key configured for this microservice in EPR. Alternatively, wire mutual-auth via private networking.
- **Future Cross-Service Calls**: Market lifecycle events can be propagated back into EPR using its `/api/v1/events` ingestion API (see EPR README). The `eventProcessingService` skeleton highlights where to publish follow-up events once Sapphire state changes are confirmed.

> **Tip:** Coordinate entity identifiers between systems. `markets.owner_id` should correspond to `entities.id` in EPR to align RBAC scopes.

## Sapphire Transaction Pipeline (Skeleton)

1. Controllers queue admin actions through `MarketService`.
2. `MarketService.enqueueTransaction` estimates gas (with ceiling guard), builds encrypted calldata (stub), and pushes a job onto the BullMQ queue.
3. `TransactionManager` workers process jobs, calling the Sapphire RPC client and updating the `transactions` table.
4. Failed jobs retry with exponential backoff. Terminal failures drop into the DLQ and trigger an alert hook placeholder.
5. `MarketEventListener` (polling stub) will ingest Sapphire registry events, call `eventProcessingService`, and persist `market_events` records to provide GET `/markets/:id/history`.

## Validation & Auth

- `middlewares/requestValidation` uses Zod to enforce request schemas.
- `middlewares/adminAuth` accepts either an `x-api-key` header or a Bearer JWT (validated with the configured public key). Required roles are enforced per-route.
- `middlewares/rateLimiter` applies configurable rate limits across all `/api/v1` endpoints.
- `middlewares/errorHandler` standardises error responses and surfaces validation issues cleanly.

## Next Steps

- Implement the actual Sapphire SDK calls in `lib/encryption/encryptedCalldata.ts` and `services/transactionManager.ts`.
- Replace event polling stubs with live WebSocket subscriptions or RPC filters.
- Complete unit/integration tests (Vitest `it.todo` markers indicate high-priority coverage areas).
- Wire DLQ notifications into your alerting stack (PagerDuty, Slack, etc.).
- Extend `eventProcessingService` to update `markets` table status transitions based on on-chain state changes.

This scaffold is intentionally lightweight while covering all required integration points so teams can focus on domain-specific logic. Let me know if you need deeper implementation help for any section.
