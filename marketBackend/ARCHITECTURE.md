# Tokenized Asset Trading Platform - Architecture

## Overview

This backend service implements a comprehensive tokenized asset trading platform supporting Real-World Assets (RWAs) and cryptocurrencies. The architecture prioritizes RWA issuance lifecycle management with integrated approval workflows, followed by trading capabilities. The system follows industry best practices for compliance, blockchain integration, and high-performance trading.

## Core Philosophy: RWA Issuance-First Design

Markets in this platform represent tokenized RWAs (real estate, corporate stock, commodities, etc.). The lifecycle is:

1. **Issuer Registration** → Market created with asset details
2. **Approval Flow** → Integration with Entity Permissions Core for compliance
3. **Token Deployment** → Sapphire blockchain contract deployment
4. **Market Activation** → Live trading enabled
5. **Trading Operations** → Order matching, settlement, transfers

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Express API Server (Port 3000)                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌───────────────────┬────────────────────┬───────────────────────┐
│ Market Lifecycle  │  Trading Service   │  Token Service        │
│ (RWA Issuance)    │  (Order Matching)  │  (Mint/Transfer)      │
│ - Registration    │  - Orders/Swaps    │  - Balance Mgmt       │
│ - Approval Flow   │  - Settlement      │  - Compliance         │
│ - Token Deploy    │  - Market Data     │                       │
└───────────────────┴────────────────────┴───────────────────────┘
         ↓                    ↓                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Market Event Broker                             │
│  - Lifecycle Events    - Approval Workflow    - Integration Hub │
│  - Entity Permissions  - Sapphire Callbacks   - Audit Trail     │
└─────────────────────────────────────────────────────────────────┘
         ↓                    ↓                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Redis Cache Layer                            │
│  - Market Status   - Order Books    - Token Metadata            │
│  - Approval Queue  - Balances       - Recent Trades             │
└─────────────────────────────────────────────────────────────────┘
         ↓                    ↓                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                      BullMQ Job Queues                           │
│  - Token Deploy    - Settlement     - Notifications             │
│  - Mint Token      - Transfer       - Blockchain Sync           │
│  - Compliance      - Analytics      - Price Feeds               │
└─────────────────────────────────────────────────────────────────┘
         ↓                    ↓                      ↓
┌─────────────┬────────────────┬──────────────────┬───────────────┐
│ PostgreSQL  │ Redis          │ Entity Perms     │ Sapphire      │
│ (ACID Store)│ (Cache/Jobs)   │ Core (Approval)  │ (Blockchain)  │
└─────────────┴────────────────┴──────────────────┴───────────────┘
```

## Layer 0: Market Lifecycle (RWA Issuance & Approval)

### Purpose
Manages the complete lifecycle of RWA market registration, approval, and activation. This is the **primary and most critical** layer of the system.

### Components
- **marketService.ts**: RWA issuance orchestration and lifecycle management
- **marketEventBroker.ts**: Event-driven workflow coordination
- **entityPermissionsClient.ts**: Integration with approval system
- **sapphireTokenClient.ts**: Blockchain token deployment

### Market Registration Flow (Async Event-Driven)

**IMPORTANT**: This flow is now fully asynchronous. Registration returns immediately,
and approval happens through webhooks or polling.

```
┌──────────────────────────────────────────────────────────────┐
│ Step 1: Issuer Registers RWA Market                          │
│ POST /api/v1/markets/register                                │
│                                                               │
│ Input:                                                        │
│ - name: "Luxury Apartment Building"                          │
│ - assetType: "real_estate"                                   │
│ - tokenSymbol: "LUXAPT"                                      │
│ - totalSupply: 1000000                                       │
│ - assetDetails: { valuation, location, compliance docs }     │
│                                                               │
│ Process:                                                      │
│ 1. Check authorization (market.register permission)          │
│ 2. Create market record (status = 'draft')                   │
│ 3. Create asset details record                               │
│ 4. Update status to 'pending_approval'                       │
│ 5. Publish 'market.registered' event                         │
│ 6. Publish 'market.approval_requested' event                 │
│ 7. RETURN IMMEDIATELY ✓                                      │
│                                                               │
│ Output: Market created, status = 'pending_approval'          │
│ Response time: ~100ms (no blocking wait)                     │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Step 2: [ASYNC] Admin Reviews in Entity Permissions Core     │
│                                                               │
│ Happens independently - issuer doesn't wait                  │
│                                                               │
│ Admin sees:                                                   │
│ - Market details                                             │
│ - Asset valuation                                            │
│ - Compliance documents                                        │
│ - Issuer credentials                                          │
│                                                               │
│ Admin decides: APPROVE or REJECT                             │
│                                                               │
│ Time: Minutes to days (human review)                         │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Step 3: [ASYNC] Entity Permissions Publishes Event           │
│                                                               │
│ Entity_Permissions_Core publishes to SNS topic:              │
│ {                                                             │
│   "event_id": "uuid",                                        │
│   "event_type": "market.approved" OR "market.rejected",     │
│   "payload": {                                               │
│     "market_id": "...",                                      │
│     "entity_id": "...",                                      │
│     "decision": "approved" | "rejected",                     │
│     "reason": "..."                                          │
│   },                                                          │
│   "context": { "actor_id": "admin-uuid" }                    │
│ }                                                             │
│                                                               │
│ SNS fans out to:                                             │
│ - Webhook: POST /api/v1/webhooks/entity-permissions          │
│ - OR polling picks it up from /api/v1/events API             │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Step 4: [ASYNC] Webhook Receives Approval Decision           │
│ POST /api/v1/webhooks/entity-permissions                     │
│                                                               │
│ Process:                                                      │
│ 1. Check if event already processed (idempotency)           │
│    → Query processed_events table                            │
│    → If exists, return 200 (already handled)                 │
│                                                               │
│ 2. Validate event structure                                  │
│    → Parse SNS envelope or direct payload                    │
│    → Validate required fields                                │
│                                                               │
│ 3. Route to approval handler                                 │
│    → Call marketEventBroker.handleEntityPermissionDecision() │
│    → Call marketService.processApprovalDecision()            │
│                                                               │
│ 4. Record event as processed                                 │
│    → Insert into processed_events table                      │
│    → Status: success/failed/skipped                          │
│                                                               │
│ 5. Return 200 OK                                             │
│                                                               │
│ If APPROVED:                                                 │
│   - status = 'approved'                                      │
│   - Event: 'market.approved'                                 │
│   - Automatically triggers Step 5 (activation)               │
│                                                               │
│ If REJECTED:                                                 │
│   - status = 'rejected'                                      │
│   - rejectedReason stored                                    │
│   - Event: 'market.rejected'                                 │
│   - STOP: Market cannot proceed                              │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Step 5: [ASYNC] Token Deployment to Sapphire via BullMQ     │
│ Automatic on approval or manual via POST /:id/activate       │
│                                                               │
│ Service Layer (Non-Blocking):                                │
│ 1. status = 'activating'                                     │
│ 2. Event: 'market.activation_started'                        │
│ 3. Enqueue job to 'deploy-token' BullMQ queue               │
│    - Job data: marketId, tokenName, symbol, supply, etc.    │
│ 4. Return immediately (API responds in <100ms)              │
│                                                               │
│ Worker Process (Async):                                      │
│ 5. Worker picks up job from queue                           │
│ 6. Call Sapphire: sapphireTokenClient.deployToken()         │
│    - Deploy ERC-20 contract                                  │
│    - Wait for transaction confirmation                       │
│    - Return contractAddress & txHash                         │
│ 7. Update market in database:                                │
│    - contractAddress                                         │
│    - deploymentTxHash                                        │
│    - status = 'active'                                       │
│    - activatedAt timestamp                                   │
│ 8. Event: 'market.activated'                                 │
│                                                               │
│ On Failure:                                                  │
│   - BullMQ retries up to 5 times (exponential backoff)      │
│   - After final failure: Revert to 'approved' status        │
│   - Store error in metadata                                  │
│   - Allow manual retry via API                               │
│                                                               │
│ Benefits:                                                     │
│   ✓ Non-blocking API (instant response)                     │
│   ✓ Automatic retry with exponential backoff                │
│   ✓ Horizontal scaling (multiple workers)                   │
│   ✓ Job monitoring and observability                        │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ Step 6: Market is LIVE                                       │
│ status = 'active'                                            │
│ Trading operations enabled                                    │
│ Token minting/transfers available                            │
│                                                               │
│ Total time from registration to activation:                  │
│ - Technical: ~10-30 seconds (token deployment)               │
│ - Business: Hours to days (human approval)                   │
└──────────────────────────────────────────────────────────────┘
```

### Event Processing Guarantees

**Idempotency**:
- Every external event has unique `event_id`
- `processed_events` table prevents duplicate processing
- Webhook can be called multiple times safely (SNS retries)

**Ordering**:
- Events may arrive out of order
- System validates market status before processing
- Invalid state transitions are rejected with clear errors

**Failure Handling**:
- Failed event processing recorded in `processed_events`
- Manual retry via admin endpoint (future enhancement)
- Monitoring alerts on failed events

**Polling Fallback**:
- Runs every 10 seconds if enabled
- Queries `/api/v1/events` endpoint
- Skips already-processed events
- Higher latency but no infrastructure dependencies

### Database Tables (Migration 003_market_rwa_lifecycle.ts)

**markets** (enhanced):
- `asset_type`: real_estate | corporate_stock | government_bond | etc.
- `issuer_id`: UUID of the issuer entity
- `contract_address`: Sapphire token contract address
- `deployment_tx_hash`: Blockchain transaction hash
- `token_symbol`, `token_name`, `total_supply`: Token details
- `approved_by`, `approved_at`: Approval tracking
- `activated_at`: Activation timestamp
- `rejected_reason`: If rejected, why

**market_assets**:
- Detailed RWA information
- `valuation`, `currency`, `location`
- `compliance_documents`: Array of document IDs
- `regulatory_info`: Jurisdiction, regulator details
- `attributes`: Custom properties (sqft, units, yield, etc.)

**market_approval_events**:
- Complete audit trail of lifecycle events
- `event_type`: market.registered | approved | rejected | activated | etc.
- `actor_id`, `actor_type`: Who performed the action
- `decision`, `reason`: Approval/rejection details
- `metadata`: Additional context

**processed_events** (NEW - Migration 004):
- Tracks external events for idempotency
- `event_id`: Unique identifier from external system (Entity Permissions, SNS)
- `event_type`: Type of event (market.approved, market.rejected, etc.)
- `source`: Origin system (entity_permissions_core, sapphire, etc.)
- `payload`: Full event payload as JSONB
- `context`: Event context (actor, timestamp, etc.)
- `processing_status`: success | failed | skipped
- `processing_error`: Error message if processing failed
- Prevents duplicate processing of webhooks and polled events

### Event Broker Integration

The **Market Event Broker** (`marketEventBroker.ts`) manages:

1. **Event Publishing**: All lifecycle state changes
2. **Event History**: Complete audit trail per market
3. **External Integration**: Webhooks to Entity Permissions Core
4. **State Verification**: Check if market reached specific states

Key Methods:
```typescript
await marketEventBroker.publishEvent({
  marketId,
  eventType: 'market.approved',
  actorId: admin.id,
  actorType: 'admin',
  decision: 'approved',
  metadata: { entityId }
});

const events = await marketEventBroker.getMarketEventHistory(marketId);
const isApproved = await marketEventBroker.hasReachedState(marketId, 'market.approved');
```

### Entity Permissions Core Integration

Located at `/Users/gilgamesh/OmenBackEnd/Entity_Permissions_Core`.

**Authorization Flow**:
```typescript
const response = await entityPermissionsClient.authorize({
  principalId: admin.id,
  principalType: 'admin',
  entityId: issuer.entityId,
  action: 'market.register',
  context: { roles: admin.roles }
});

if (!response.allowed) {
  throw new ApplicationError('Forbidden', { reasons: response.reasons });
}
```

**Permissions Required**:
- `market.register`: Issuer can create new markets
- `market.approve`: Admin can approve markets
- `market.reject`: Admin can reject markets
- `market.pause`: Admin can pause active markets
- `market.archive`: Admin can archive markets

### Asset Types Supported

```typescript
type AssetType =
  | 'real_estate'        // Residential, commercial, industrial property
  | 'corporate_stock'    // Private company equity
  | 'government_bond'    // Treasury bonds, municipal bonds
  | 'commodity'          // Gold, oil, agricultural products
  | 'private_equity'     // VC funds, PE funds
  | 'art_collectible'    // Fine art, collectibles
  | 'carbon_credit'      // Environmental credits
  | 'other';             // Custom RWAs
```

### API Endpoints

#### Market Lifecycle Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/markets/register` | POST | Issuer | Register new RWA market |
| `/markets/:id/approve` | POST | Admin | Approve/reject market |
| `/markets/:id/activate` | POST | Admin | Manually activate market |
| `/markets/:id/pause` | POST | Admin | Pause active market |
| `/markets/:id/archive` | POST | Admin | Archive market |
| `/markets` | GET | Public | List markets (filtered) |
| `/markets/:id` | GET | Public | Get market details |
| `/markets/:id/details` | GET | Public | Get market + asset info |
| `/markets/:id/events` | GET | Public | Get event history |

#### Webhook Endpoints (NEW - December 2025)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/webhooks/health` | GET | None | Health check for webhook service |
| `/webhooks/entity-permissions` | POST | None* | Receive approval events from Entity Permissions Core |

*Webhook signature validation happens inside handler (not middleware)

### Market States

```
draft → pending_approval → approved → activating → active
                     ↓
                  rejected

active → paused → active
active → archived
```

---

## Layer 1: Market API (Market Data & Price Feeds)

### Purpose
Aggregates price feeds for active markets, provides historical data, delivers real-time market information.

### Components
- **marketController.ts**: Existing market management endpoints
- **marketDataService.ts**: NEW - Market data aggregation and caching

### BullMQ Jobs
- `fetch-external-prices`: Every 10s, pull prices from external sources (Chainlink, CoinGecko)
- `aggregate-candles`: Every 1min/5min/1hr, compute OHLCV from trades
- `update-token-metadata`: Daily, fetch RWA valuations and compliance updates

### Redis Cache Structure
```javascript
{
  'market:<pair-id>:price': { price: '98234.50', timestamp: ... },
  'market:<pair-id>:depth': { bids: [...], asks: [...] },
  'market:<pair-id>:stats': { volume24h, high24h, low24h, ... },
  'candles:<pair-id>:<interval>': [{ open, high, low, close, volume }],
  'trades:recent:<pair-id>': [last 100 trades]
}
```

### Database Tables
- `price_candles`: Historical OHLCV data
- `market_stats`: 24h statistics (volume, high, low, price changes)
- `trading_pairs`: Available trading pairs configuration

## Layer 2: Token Service (Mint, Transfer, Balances)

### Purpose
Manages tokenized assets (RWAs and crypto), handles minting, transfers, and compliance.

### Components
- **tokenService.ts**: Token operations orchestration
- **tokenRepository.ts**: Database access for tokens and balances
- **sapphireTokenClient.ts**: Blockchain interaction via Sapphire

### BullMQ Jobs
- `deploy-token`: **NEW** - Deploy token contracts for market activation (async, retries: 5)
- `mint-token`: Mint new tokens on-chain (async)
- `process-transfer`: Execute token transfers
- `sync-blockchain`: Poll blockchain for events
- `verify-compliance`: KYC/AML checks for RWA tokens
- `process-withdrawal`: Handle user withdrawal requests

### Redis Cache Structure
```javascript
{
  'token:metadata:<token-id>': { name, symbol, type, ... },
  'token:balance:<user-id>:<token-id>': { available, locked },
  'user:session:<user-id>': { balances, locked amounts }
}
```

### Database Tables
- `tokens`: Token definitions (symbol, type, contract address)
- `user_balances`: User token holdings (available + locked)
- `compliance_records`: KYC/AML status, whitelisting for RWAs
- `blockchain_events`: On-chain event tracking
- `withdrawal_requests`: Withdrawal processing queue

### Compliance Flow
For RWA tokens, every operation checks:
1. KYC status (APPROVED)
2. Whitelist status (true)
3. Accreditation (if required)
4. Expiry dates

## Layer 3: Trading Service (Order Matching & Settlement)

### Purpose
Order submission, in-memory matching engine, trade execution, settlement.

### Components
- **tradingService.ts**: Order matching and execution
- **tradingRepository.ts**: Database access for orders and trades

### Order Flow
```
1. User submits order
   ↓
2. Validate (balance, compliance, pair status)
   ↓
3. Lock funds (quote token for BUY, base token for SELL)
   ↓
4. Try matching with opposing orders (IN-MEMORY)
   ↓
5a. Match found → Execute trade (ATOMIC TRANSACTION)
    - Update balances (both users)
    - Update order status
    - Create trade record
    - Enqueue settlement job
   ↓
5b. No match → Add to order book (Redis sorted set)
   ↓
6. Post-processing (async via BullMQ)
   - Blockchain settlement
   - Notifications
   - Analytics update
```

### Critical Design: ACID Settlement
All balance updates happen **synchronously in a PostgreSQL transaction**:
```sql
BEGIN;
  -- Deduct from seller
  -- Credit to buyer
  -- Update order status
  -- Create trade record
COMMIT;
```

**Blockchain settlement happens ASYNCHRONOUSLY** after the trade is confirmed in the database.

### BullMQ Jobs
- `execute-blockchain-settlement`: On-chain token transfers (post-trade)
- `send-trade-notification`: Email/SMS notifications
- `update-market-stats`: Aggregate volume, update leaderboards

### Redis Cache Structure
```javascript
{
  'orderbook:<pair-id>:bids': SortedSet (price sorted),
  'orderbook:<pair-id>:asks': SortedSet (price sorted),
  'user:open-orders:<user-id>': [order IDs],
  'ratelimit:<user-id>:orders': 100 // orders per minute
}
```

### Database Tables
- `orders`: All orders (open, partial, filled, cancelled)
- `trades`: Completed matches
- `trading_pairs`: Pair configuration (min/max size, precision)
- `audit_log`: Every action logged for compliance

## Data Flow Examples

### Example 1: User Buys RWA Token

```
1. POST /api/v1/trading/orders
   { tradingPairId: "PROPERTY-TOKEN-001-USDC", side: "BUY", type: "LIMIT", price: "1000", quantity: "5" }
   ↓
2. TradingService.submitOrder()
   - Check user has 5000 USDC available
   - Check compliance (KYC, whitelist for RWA)
   - Lock 5000 USDC
   ↓
3. In-Memory Matching Engine
   - Find best SELL orders at ≤ $1000
   - Match 5 tokens at $1000
   ↓
4. PostgreSQL Transaction (ATOMIC)
   - Buyer: locked USDC -5000, available PROPERTY +5 (minus fee)
   - Seller: locked PROPERTY -5, available USDC +5000 (minus fee)
   - Orders: status = FILLED
   - Trades: new record
   ↓
5. Redis Updates (IMMEDIATE)
   - Remove orders from order book
   - Cache recent trade
   - Invalidate order book cache
   ↓
6. BullMQ Jobs (ASYNC)
   - Settlement queue: Transfer tokens on-chain
   - Notification queue: Send trade confirmations
   - Analytics queue: Update 24h volume stats
```

### Example 2: External Price Update

```
1. BullMQ Job: fetch-external-prices (every 10s)
   ↓
2. Fetch from Chainlink/CoinGecko
   ↓
3. Write to Redis
   'market:BTC-USDC:price': { price: 98234.50, timestamp: ... }
   ↓
4. WebSocket broadcast to connected clients (if implemented)
   ↓
5. If price changed significantly, trigger alert job
```

## Database Schema Highlights

### Core Tables
- **tokens**: 11 columns, supports RWA/CRYPTO/STABLE types
- **user_balances**: available + locked balance pattern
- **orders**: Full order lifecycle (open → partial → filled/cancelled)
- **trades**: Settlement status tracking (pending → settled/failed)
- **compliance_records**: Per-user-per-token KYC/whitelist status
- **audit_log**: Immutable log of all critical actions

### Indexes (Performance Critical)
- `idx_orders_pair_status`: Fast order book queries
- `idx_orders_status`: Open orders lookup
- `idx_trades_pair`: Recent trades by pair
- `idx_user_balances_user`: User portfolio queries
- `idx_blockchain_events_unprocessed`: Event processing queue

## Key Design Principles

### 1. Hot Path vs Cold Path
- **Hot Path** (sub-100ms): Order matching, balance checks → Redis + In-Memory
- **Cold Path** (async): Blockchain settlement, notifications → BullMQ

### 2. Data Consistency
- **ACID guarantees** for trades (PostgreSQL transactions)
- **Eventual consistency** for on-chain settlement
- **Cache invalidation** on critical updates

### 3. Scalability Patterns
- **Horizontal scaling**: Stateless API servers
- **Queue-based processing**: BullMQ workers can scale independently
- **Caching layers**: Redis reduces database load by 90%+

### 4. Compliance First
- Every RWA operation checks compliance
- Audit log for regulatory reporting
- Withdrawal approvals before on-chain execution

## Sapphire Integration

The Sapphire service at `/Users/gilgamesh/OmenBackEnd/Sapphire` is called for:
- **Token contract deployment** (via BullMQ `deploy-token` queue)
- Minting new token supply
- On-chain transfers (post-trade settlement)
- Balance verification
- Event listening (blockchain sync)

### Integration Points

#### Token Deployment (Async via BullMQ)
```typescript
// In MarketService.activateMarket() - Enqueue job
const deploymentQueue = getTokenDeploymentQueue();
await deploymentQueue.add('deploy-market-token', {
  marketId,
  tokenName: market.tokenName,
  tokenSymbol: market.tokenSymbol,
  decimals: 18,
  totalSupply: market.totalSupply.toString(),
  actorId: admin.id
});

// In Worker Handler (runs async)
const sapphireClient = getSapphireTokenClient();
const deployment = await sapphireClient.deployToken({
  name: tokenName,
  symbol: tokenSymbol,
  decimals,
  initialSupply: totalSupply,
  signerPrivateKey: AppConfig.sapphire.privateKey
});
// Returns: { address: '0x...', txHash: '0x...' }
```

#### Token Minting (Example)
```typescript
const sapphireClient = getSapphireTokenClient();
const txHash = await sapphireClient.mintToken({
  tokenAddress: token.contractAddress,
  recipient: userId,
  amount: mintAmount,
  signerPrivateKey: adminKey
});
```

## Configuration Requirements

### Environment Variables
```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_TLS=false

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/marketdb

# Sapphire
SAPPHIRE_RPC_URL=https://sapphire.oasis.io
SAPPHIRE_CHAIN_ID=23294
SAPPHIRE_ADMIN_KEY=0x...

# Queue Config
QUEUE_WORKER_CONCURRENCY=5
QUEUE_MAX_RETRY_ATTEMPTS=3
```

## Deployment Checklist

1. **Database Migration**
   ```bash
   npm run migrate
   ```

2. **Initialize Queues**
   - All 11 BullMQ queues auto-initialize on startup

3. **Start Workers**
   - Workers are registered in bootstrap process
   - Each queue type has dedicated worker pool

4. **Verify Integrations**
   - Redis connectivity
   - PostgreSQL pool
   - Sapphire RPC endpoint
   - External price feeds (if configured)

## Monitoring & Observability

### Key Metrics to Track
- Order matching latency (target: <50ms)
- Trade execution success rate
- Blockchain settlement lag
- Redis cache hit rate
- Queue processing rates
- Database connection pool utilization

### Logging
- All services use structured logging (Pino)
- Correlation IDs for request tracing
- Audit log for compliance

## Security Considerations

1. **Rate Limiting**: Applied at API and per-user order submission
2. **Input Validation**: Zod schemas for all endpoints
3. **SQL Injection**: Parameterized queries only
4. **Private Keys**: Never logged, encrypted at rest
5. **Compliance Checks**: Cannot be bypassed for RWA tokens

## Future Enhancements

- WebSocket support for real-time order book updates
- Advanced order types (stop-loss, trailing stop)
- Margin trading support
- Cross-chain atomic swaps
- Market maker incentive programs
- Liquidity pools for thin RWA markets

---

**Implementation Date**: November 2025
**Last Updated**: November 28, 2025 (Added BullMQ-based token deployment)
