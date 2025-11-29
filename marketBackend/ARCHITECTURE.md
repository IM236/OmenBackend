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
│  - Token Deploy    - Order Matching - Settlement                │
│  - Mint Token      - Transfer       - Notifications             │
│  - Compliance      - Analytics      - Blockchain Sync           │
│  - Reconciliation  - Price Feeds                                │
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
**Non-blocking** order submission with EIP-712 signature verification, **asynchronous** order matching via BullMQ workers, Redis-backed order book optimization, trade execution, and on-chain settlement.

### Components
- **tradingService.ts**: Order validation and submission (non-blocking)
- **matchingWorkerHandler.ts**: **NEW** - Async order matching worker with Redis-backed order book
- **settlementWorkerHandler.ts**: On-chain settlement via Sapphire
- **tradingController.ts**: REST API endpoints for trading operations
- **tradingRepository.ts**: Database access for orders and trades
- **EIP712Verifier**: Cryptographic signature verification
- **NonceService**: Replay attack prevention
- **tradingEventPublisher.ts**: Event publishing for order lifecycle

### Security Architecture

All user trading actions require **EIP-712 signatures**:
- **Order placement**: User signs order with private key
- **Deposits**: User signs deposit request
- **Withdrawals**: User signs withdrawal request

This ensures:
1. **Non-repudiation**: User cannot deny placing order
2. **Replay protection**: Nonces prevent signature reuse
3. **Expiry**: Time-bound signatures prevent stale orders
4. **Authorization**: Signature proves user owns the address

### Order Flow (Non-Blocking with BullMQ Matching)

**CRITICAL CHANGE**: Order matching is now **fully asynchronous** via BullMQ workers.
The API returns immediately after validation, and matching happens in the background.

```
1. User submits signed order
   POST /api/v1/trading/orders
   {
     "tradingPairId": "...",
     "side": "BUY",
     "orderType": "LIMIT",
     "quantity": "10",
     "price": "50.00",
     "signature": "0x...",
     "nonce": "...",
     "expiry": 1234567890,
     "userAddress": "0x..."
   }
   ↓
2. TradingService.submitOrder() - SYNCHRONOUS (target: <100ms)
   ├─ Validate EIP-712 signature
   │  ├─ Verify signature matches userAddress
   │  ├─ Check nonce hasn't been used (Redis)
   │  ├─ Validate expiry timestamp
   │  └─ Mark nonce as used (TTL: 1 hour)
   │
   ├─ Validate trading pair
   │  ├─ Check pair exists and is active
   │  └─ If RWA market: validate compliance (KYC, whitelist)
   │
   ├─ Validate order parameters
   │  ├─ Check min/max order size
   │  ├─ Validate price (for LIMIT/STOP_LIMIT orders)
   │  └─ Check user has sufficient balance
   │
   ├─ Lock funds in database
   │  ├─ BUY: Lock quote token (e.g., USDC)
   │  └─ SELL: Lock base token (e.g., RWA token)
   │
   ├─ Create order record (status: PENDING_MATCH)
   │  └─ Order stored in PostgreSQL
   │
   ├─ Publish 'order.created' event
   │  └─ Redis pub/sub + Entity Permissions Core
   │
   ├─ Enqueue matching job to BullMQ
   │  └─ Queue: 'order-matching'
   │     ├─ Job data: { orderId, tradingPairId }
   │     ├─ Priority: MARKET orders = 1, LIMIT orders = 5
   │     ├─ Retry: 5 attempts with exponential backoff
   │     └─ Job ID: "match-{orderId}"
   │
   └─ Return order to client (status: PENDING_MATCH)
      Response time: ~50-100ms ✓ NON-BLOCKING

   ↓
3. MatchingWorker processes job - ASYNCHRONOUS
   ├─ Fetch order from database
   │  └─ Skip if order is no longer matchable (cancelled, filled)
   │
   ├─ Transition order: PENDING_MATCH → OPEN
   │  └─ Publish 'order.open' event
   │
   ├─ Get opposing orders from Redis-backed order book
   │  ├─ Key: "orderbook:{tradingPairId}:{side}s"
   │  ├─ Sorted by price (best prices first)
   │  ├─ Fallback to database if Redis cache miss
   │  └─ Limit: Top 100 orders
   │
   ├─ Execute matching algorithm
   │  └─ For each opposing order:
   │     ├─ Check if prices match
   │     │  ├─ MARKET orders: Always match
   │     │  ├─ BUY orders: buyPrice >= sellPrice
   │     │  └─ SELL orders: sellPrice <= buyPrice
   │     │
   │     ├─ Calculate match quantity
   │     │  └─ min(remaining, opposingRemaining)
   │     │
   │     └─ Execute trade (see step 4)
   │
   ├─ Update final order status
   │  ├─ FILLED: All quantity matched
   │  ├─ PARTIAL: Some quantity matched, remainder in book
   │  └─ OPEN: No matches, added to order book
   │
   └─ Schedule re-matching for opposing orders
      └─ Enqueue matching jobs for top 10 opposing orders
         (Enables continuous matching as market conditions change)

   ↓
4. Execute Trade - ATOMIC TRANSACTION (per match)
   ├─ PostgreSQL transaction BEGIN
   │
   ├─ Create trade record
   │  ├─ Link buyer and seller order IDs
   │  ├─ Record price and quantity
   │  ├─ Calculate fees (0.25% for both sides)
   │  └─ Status: PENDING settlement
   │
   ├─ Update buyer balances
   │  ├─ Unlock quote token (locked amount)
   │  ├─ Add base token (quantity - fee)
   │  └─ Atomic balance update
   │
   ├─ Update seller balances
   │  ├─ Unlock base token (locked amount)
   │  ├─ Add quote token (value - fee)
   │  └─ Atomic balance update
   │
   ├─ Update order statuses
   │  ├─ Increment filledQuantity
   │  ├─ Set status: PARTIAL or FILLED
   │  └─ Update averageFillPrice
   │
   ├─ Create audit logs (both users)
   │  └─ Action: 'TRADE_EXECUTED'
   │
   └─ PostgreSQL transaction COMMIT
      ↓
   ├─ On Success:
   │  ├─ Invalidate order book cache (Redis)
   │  ├─ Update Redis order book (if order still open)
   │  ├─ Publish 'trade.executed' event
   │  ├─ Publish 'trade.settlement_pending' event
   │  ├─ Publish 'order.filled' or 'order.partially_filled' event
   │  │
   │  └─ Enqueue async jobs to BullMQ:
   │     ├─ Settlement queue: 'execute-blockchain-settlement'
   │     ├─ Notification queue: 'send-trade-notification'
   │     └─ Analytics queue: 'update-market-stats'
   │
   └─ On Failure:
      ├─ PostgreSQL ROLLBACK
      ├─ Log error
      └─ Continue to next opposing order

   ↓
5. Post-Trade Processing - ASYNCHRONOUS (BullMQ)
   ├─ Blockchain Settlement Worker
   │  ├─ Call Sapphire to transfer tokens on-chain
   │  ├─ Wait for transaction confirmation
   │  ├─ Update trade status: SETTLED
   │  ├─ Store blockchain txHash
   │  ├─ Publish 'trade.settled' event
   │  └─ Retry: 5 attempts with exponential backoff
   │
   ├─ Notification Worker
   │  ├─ Send email/SMS to buyer and seller
   │  ├─ Include trade details and confirmation
   │  └─ Retry: 3 attempts
   │
   └─ Analytics Worker
      ├─ Update 24h volume statistics
      ├─ Update price candles
      ├─ Update market stats (high, low, last price)
      └─ Retry: 3 attempts
```

### Critical Design: Non-Blocking Architecture

**API Response Time**: ~50-100ms (signature verification + validation + enqueue)
**Matching Latency**: ~100-500ms (worker picks up job and executes matching)
**Total Time to Match**: ~150-600ms (end-to-end)

**Benefits**:
1. ✅ **Instant API response** - No blocking on matching logic
2. ✅ **Horizontal scalability** - Run multiple matching workers
3. ✅ **Resilience** - Worker failures don't affect API availability
4. ✅ **Retry logic** - Automatic retry with exponential backoff
5. ✅ **Observability** - Full job tracking and monitoring via BullMQ

### Order Status Lifecycle

```
PENDING_MATCH → OPEN → PARTIAL → FILLED
      ↓           ↓        ↓
   CANCELLED  CANCELLED CANCELLED
```

**Status Definitions**:
- `PENDING_MATCH`: Order created, waiting for matching worker to process
- `OPEN`: Order in the order book, no matches yet
- `PARTIAL`: Order partially filled, remainder in book
- `FILLED`: Order completely filled
- `CANCELLED`: Order cancelled by user or system
- `REJECTED`: Order rejected during validation

### Redis-Backed Order Book Optimization

**Previous Implementation**: Direct PostgreSQL queries on every match attempt
**New Implementation**: Redis sorted sets with PostgreSQL fallback

```javascript
// Redis Structure
{
  // Order book sorted by price
  "orderbook:{tradingPairId}:bids": SortedSet (score: -price, value: order JSON),
  "orderbook:{tradingPairId}:asks": SortedSet (score: price, value: order JSON),

  // Cache aggregated order book for public API
  "market:{tradingPairId}:depth": { bids: [...], asks: [...] } (TTL: 10s),

  // Recent trades
  "trades:recent:{tradingPairId}": List (last 100 trades),

  // Nonce management
  "nonce:{userAddress}:{nonce}": "1" (TTL: 1 hour)
}
```

**Performance Impact**:
- Order book lookup: ~1-2ms (Redis) vs ~50-100ms (PostgreSQL scan)
- Matching throughput: ~500 orders/sec (Redis) vs ~50 orders/sec (PostgreSQL)
- 10x reduction in database load during high-volume trading

### Critical Design: ACID Settlement

All balance updates happen **synchronously in a PostgreSQL transaction** within the matching worker:
```sql
BEGIN;
  -- Create trade record
  -- Update buyer balances (unlock quote, add base)
  -- Update seller balances (unlock base, add quote)
  -- Update order filled quantities and statuses
  -- Create audit logs
COMMIT;
```

**Blockchain settlement happens ASYNCHRONOUSLY** after the trade is confirmed in the database via a separate settlement worker.

### Event Publishing

The trading system publishes events to Redis pub/sub and Entity Permissions Core for real-time updates:

**Event Types**:
- `order.created`: Order submitted and validated (status: PENDING_MATCH)
- `order.open`: Order entered the order book (status: OPEN)
- `order.partially_filled`: Order partially matched (status: PARTIAL)
- `order.filled`: Order completely filled (status: FILLED)
- `order.cancelled`: Order cancelled by user (status: CANCELLED)
- `order.matched`: **DEPRECATED** - Use order.partially_filled or order.filled instead
- `trade.executed`: Trade executed between two orders
- `trade.settlement_pending`: Trade awaiting on-chain settlement
- `trade.settled`: Trade successfully settled on-chain
- `trade.settlement_failed`: Settlement failed after retries

**Event Structure**:
```typescript
{
  eventId: "order.created.uuid.timestamp",
  eventType: "order.created",
  timestamp: Date,
  userId: "user-uuid",
  orderId: "order-uuid",
  tradingPairId: "pair-uuid",
  payload: {
    orderId: "...",
    status: "PENDING_MATCH",
    side: "BUY",
    orderType: "LIMIT",
    price: "50.00",
    quantity: "10"
    // ... event-specific data
  }
}
```

**Event Flow Example**:
```
order.created (PENDING_MATCH)
  ↓
order.open (OPEN) - If no immediate match
  ↓
order.partially_filled (PARTIAL) - First match
  ↓
trade.executed - Trade details
  ↓
trade.settlement_pending - Queued for blockchain
  ↓
order.partially_filled (PARTIAL) - Second match
  ↓
trade.executed - Second trade
  ↓
order.filled (FILLED) - All quantity matched
  ↓
trade.settled - Both trades confirmed on-chain
```

### Authorization Caching

Authorization checks are cached in Redis (TTL: 5 minutes):
- **Cache Key**: `auth:{principalId}:{entityId}:{action}:{contextHash}`
- **Cache Invalidation**: On permission changes or user updates
- **Fallback**: Direct call to Entity Permissions Core on cache miss

### BullMQ Jobs

**Trading & Matching**:
- `order-matching`: **NEW** - Asynchronous order matching engine
  - Queue name: `order-matching`
  - Concurrency: 10 workers
  - Rate limit: 100 jobs/second
  - Retry: 5 attempts with exponential backoff
  - Priority: MARKET orders (1) > LIMIT orders (5)
  - Stalled job check: Every 30 seconds

**Settlement & Post-Trade**:
- `execute-blockchain-settlement`: On-chain token transfers (post-trade)
  - Concurrency: 3 workers
  - Retry: 5 attempts with exponential backoff
  - Processes trades after matching completes

- `send-trade-notification`: Email/SMS notifications
  - Concurrency: 10 workers
  - Retry: 3 attempts

- `update-market-stats`: Aggregate volume, update leaderboards
  - Concurrency: 5 workers
  - Retry: 3 attempts

### Redis Cache Structure
```javascript
{
  // Order Book (Redis-backed for fast matching)
  'orderbook:<pair-id>:bids': SortedSet (score: -price, value: order JSON),
  'orderbook:<pair-id>:asks': SortedSet (score: price, value: order JSON),
  'user:open-orders:<user-id>': List (order IDs, TTL: 5 minutes),

  // Aggregated Order Book (Public API cache)
  'market:<pair-id>:depth': JSON (bids/asks aggregated, TTL: 10 seconds),

  // Recent Trades
  'trades:recent:<pair-id>': List (last 100 trades),

  // Nonce Management (Replay Protection)
  'nonce:<userAddress>:<nonce>': '1' (TTL: 1 hour),

  // Authorization Cache
  'auth:<principalId>:<entityId>:<action>:<hash>': 'true|false' (TTL: 5 minutes),

  // Rate Limiting
  'ratelimit:<user-id>:orders': Counter (100 orders per minute)
}
```

### Database Tables
- `orders`: All orders (open, partial, filled, cancelled)
- `trades`: Completed matches
- `trading_pairs`: Pair configuration (min/max size, precision)
- `audit_log`: Every action logged for compliance

## Data Flow Examples

### Example 1: User Buys RWA Token (Non-Blocking Flow)

```
1. POST /api/v1/trading/orders (Client → API)
   {
     tradingPairId: "PROPERTY-TOKEN-001-USDC",
     side: "BUY",
     orderType: "LIMIT",
     price: "1000",
     quantity: "5",
     signature: "0x...",
     nonce: "abc123",
     expiry: 1234567890
   }
   ↓
2. TradingService.submitOrder() - SYNCHRONOUS (~50-100ms)
   ├─ Verify EIP-712 signature
   ├─ Check user has 5000 USDC available
   ├─ Check compliance (KYC, whitelist for RWA)
   ├─ Lock 5000 USDC in database
   ├─ Create order (status: PENDING_MATCH)
   ├─ Publish 'order.created' event
   ├─ Enqueue matching job to BullMQ
   └─ Return order to client ✓ API RESPONDS IMMEDIATELY
      Response: { id: "order-123", status: "PENDING_MATCH", ... }

   ↓
3. MatchingWorker.processMatchingJob() - ASYNCHRONOUS (~100-500ms)
   ├─ Fetch order from database
   ├─ Update status: PENDING_MATCH → OPEN
   ├─ Publish 'order.open' event
   ├─ Get opposing SELL orders from Redis order book
   │  └─ Find best SELL orders at ≤ $1000
   │
   ├─ Match 5 tokens at $1000 with opposing seller
   │
   └─ Execute trade (see step 4)

   ↓
4. MatchingWorker.executeTrade() - ATOMIC TRANSACTION
   ├─ PostgreSQL BEGIN
   │
   ├─ Create trade record
   │  ├─ Buyer order ID, Seller order ID
   │  ├─ Price: $1000, Quantity: 5
   │  ├─ Fees: 0.25% each side
   │
   ├─ Update balances:
   │  ├─ Buyer: locked USDC -5000, available PROPERTY +4.9875 (minus fee)
   │  ├─ Seller: locked PROPERTY -5, available USDC +4987.50 (minus fee)
   │
   ├─ Update order statuses:
   │  ├─ Buyer order: status = FILLED
   │  └─ Seller order: status = FILLED
   │
   ├─ Create audit logs (both users)
   │
   └─ PostgreSQL COMMIT ✓

   ↓
5. Post-Commit Actions - IMMEDIATE
   ├─ Remove filled orders from Redis order book
   ├─ Cache recent trade in Redis
   ├─ Invalidate order book cache
   ├─ Publish 'order.filled' event (both orders)
   ├─ Publish 'trade.executed' event
   ├─ Publish 'trade.settlement_pending' event
   │
   └─ Enqueue BullMQ jobs:
      ├─ Settlement queue: Transfer tokens on-chain
      ├─ Notification queue: Send trade confirmations
      └─ Analytics queue: Update 24h volume stats

   ↓
6. Settlement Worker - ASYNCHRONOUS (~5-30 seconds)
   ├─ Call Sapphire blockchain to transfer tokens
   ├─ Wait for transaction confirmation
   ├─ Update trade status: SETTLED
   ├─ Store blockchain txHash
   └─ Publish 'trade.settled' event

Total Time Breakdown:
- API Response: ~50-100ms ✓ User gets immediate confirmation
- Order Matching: ~100-500ms (background worker)
- Blockchain Settlement: ~5-30 seconds (background worker)
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

## Performance & Scalability

### Matching Engine Performance

**Before (Blocking Implementation)**:
- API response time: 500-2000ms (blocked on matching)
- Database queries per order: 10-20 (repeated scans)
- Throughput: ~50 orders/second (single-threaded)
- Scaling: Vertical only (more CPU/RAM)

**After (Non-Blocking with BullMQ)**:
- API response time: 50-100ms (validation only) ✅ **10-20x faster**
- Redis queries per order: 1-2 (sorted set lookup)
- Throughput: 500+ orders/second per worker ✅ **10x improvement**
- Scaling: Horizontal (add more workers) ✅ **Infinitely scalable**

### Worker Scaling Strategy

```
Production Deployment:
┌────────────────────────────────────────────────┐
│  API Servers (3 replicas)                      │
│  - Accept orders                               │
│  - Validate signatures                         │
│  - Enqueue jobs                                │
│  - Return immediately                          │
└────────────────────────────────────────────────┘
                   ↓ BullMQ
┌────────────────────────────────────────────────┐
│  Matching Workers (10 replicas)                │
│  - Concurrency: 10 jobs each                   │
│  - Total: 100 concurrent matches               │
│  - Redis-backed order book                     │
│  - Horizontal scaling                          │
└────────────────────────────────────────────────┘
                   ↓
┌────────────────────────────────────────────────┐
│  Settlement Workers (3 replicas)               │
│  - On-chain transactions                       │
│  - Rate-limited by blockchain                  │
└────────────────────────────────────────────────┘
```

### Redis Order Book Performance

**Key Operations**:
- Insert order: O(log N) - ~1ms for 10k orders
- Get best N orders: O(log N + N) - ~2ms for top 100
- Remove order: O(log N) - ~1ms
- Total capacity: 1M+ orders per trading pair

**Memory Usage**:
- ~1KB per order in Redis
- 10,000 orders ≈ 10MB
- 1,000,000 orders ≈ 1GB

### Continuous Matching

**Previous**: Orders only matched on submission
**New**: Orders continuously re-evaluate as market changes

When a new order enters the book:
1. Match with current opposing orders
2. If any quantity remains:
   - Add to order book
   - **Schedule re-matching for top 10 opposing orders**
3. This creates a continuous matching loop:
   ```
   New BUY order → Matches with SELL orders
                → Remaining BUY sits in book
                → New SELL order arrives
                → Triggers re-matching of existing BUYs
                → More matches execute
   ```

**Benefits**:
- Orders match even after initial submission
- No need for users to cancel/resubmit
- Better price discovery
- Higher fill rates

---

**Implementation Date**: November 2025
**Last Updated**: November 29, 2025 (Implemented non-blocking order matching with BullMQ workers, Redis-backed order book, and continuous re-matching)
