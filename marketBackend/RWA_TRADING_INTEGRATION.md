# RWA Trading Integration - Complete Implementation

## Overview

This document describes the complete integration between the RWA Market Lifecycle system and the Trading System, including automatic trading pair creation, compliance checks, and blockchain reconciliation.

**Implementation Date**: November 28, 2025

---

## Architecture Integration

### Flow: From Market Creation to Trading

```
1. Issuer Registers RWA Market
   ↓
2. Admin Approves Market
   ↓
3. Token Deployment Worker Activates Market
   ├─ Deploys token to Sapphire blockchain
   ├─ Creates token record in database
   ├─ Creates USDC trading pair automatically
   └─ Sets market status to 'active'
   ↓
4. Trading Pair is Live
   ├─ Users can place orders (with signatures)
   ├─ Orders match off-chain
   ├─ Trades settle on-chain (async)
   └─ Compliance enforced for RWA tokens
   ↓
5. Periodic Reconciliation
   └─ DB vs blockchain sync every 15 minutes
```

---

## 1. Automatic Trading Pair Creation

### Implementation

When a market is activated and its token is deployed, the system automatically:
1. Creates a token record for the RWA
2. Ensures USDC token exists in the system
3. Creates a trading pair: `{RWA_TOKEN}-USDC`

**File**: `src/infra/queue/tokenDeploymentHandler.ts`

**Code Flow**:
```typescript
// After token deployment succeeds
1. Create RWA token record
   - tokenSymbol: from market
   - tokenType: 'RWA'
   - contractAddress: from Sapphire deployment
   - totalSupply: from market

2. Get or create USDC token
   - usdcTokenService.getUsdcTokenId()

3. Create trading pair
   - marketId: links back to RWA market
   - baseTokenId: RWA token
   - quoteTokenId: USDC
   - pairSymbol: "{SYMBOL}-USDC"
   - minOrderSize: '1'
   - maxOrderSize: totalSupply
```

### Example

**Market Registration**:
```json
{
  "name": "Luxury Apartment Complex",
  "assetType": "real_estate",
  "tokenSymbol": "LUXAPT",
  "tokenName": "Luxury Apartments Token",
  "totalSupply": 1000000,
  "assetDetails": {
    "valuation": 50000000,
    "currency": "USD",
    "location": "Miami, FL"
  }
}
```

**Auto-Generated Trading Pair**:
```json
{
  "id": "pair-uuid",
  "marketId": "market-uuid",
  "baseTokenId": "luxapt-token-uuid",
  "quoteTokenId": "usdc-token-uuid",
  "pairSymbol": "LUXAPT-USDC",
  "isActive": true,
  "minOrderSize": "1",
  "maxOrderSize": "1000000",
  "pricePrecision": 6,
  "quantityPrecision": 18
}
```

---

## 2. RWA Compliance Checks

### Implementation

The trading service now checks RWA compliance before allowing orders:

**File**: `src/services/tradingService.ts`

**Compliance Flow**:
```typescript
1. Check if trading pair has marketId
   ↓
2. If yes, fetch market details
   ↓
3. Verify market status is 'active'
   ↓
4. Get base token (RWA) details
   ↓
5. If token type is 'RWA':
   ├─ Check user KYC status (APPROVED)
   ├─ Check whitelist status (true)
   ├─ Check accreditation (if required)
   └─ Check expiry dates
   ↓
6. If all pass, allow order placement
   ↓
7. If any fail, reject with 403 Forbidden
```

### Compliance Requirements

For RWA tokens, users must have:
- **KYC Status**: APPROVED
- **Whitelist Status**: true
- **Accreditation**: APPROVED (if required by token)
- **Expiry**: Not expired

### Error Response Example

```json
{
  "error": "User does not meet RWA compliance requirements",
  "code": "compliance_failed",
  "statusCode": 403,
  "details": {
    "reason": "KYC verification required",
    "tokenSymbol": "LUXAPT",
    "assetType": "real_estate"
  }
}
```

---

## 3. USDC Token Service

### Purpose

Ensures a USDC token exists in the system for trading pairs.

**File**: `src/services/usdcTokenService.ts`

### Initialization

USDC token is automatically created on first use:
```typescript
{
  tokenSymbol: 'USDC',
  tokenName: 'USD Coin',
  tokenType: 'STABLE',
  blockchain: 'sapphire',
  decimals: 6,
  metadata: {
    description: 'USD Coin - Stable coin pegged to USD',
    isQuoteToken: true,
    createdBy: 'system'
  }
}
```

### Usage

```typescript
// Get USDC token ID
const usdcTokenId = await usdcTokenService.getUsdcTokenId();

// Check if a token is USDC
const isUsdc = usdcTokenService.isUsdcToken(tokenId);
```

---

## 4. Blockchain Reconciliation

### Purpose

Periodically compares database state with on-chain state and corrects discrepancies.

**File**: `src/services/blockchainReconciliationService.ts`

### What It Reconciles

#### Token Balances
- Compares total supply (DB vs on-chain)
- Compares individual user balances
- Updates DB if mismatch found

#### Trade Settlements
- Checks trades pending for > 5 minutes
- Verifies transaction status on-chain
- Updates settlement status if confirmed

### Schedule

- **Frequency**: Every 15 minutes
- **Worker Concurrency**: 1 (only one reconciliation at a time)
- **Retry**: 3 attempts on failure

### Reconciliation Process

```typescript
1. Get all active tokens with contract addresses
   ↓
2. For each token:
   ├─ Get on-chain total supply
   ├─ Compare with DB total supply
   ├─ Log discrepancy if mismatch
   ├─ Get all users with balances
   └─ For each user:
       ├─ Get on-chain balance
       ├─ Compare with DB balance (available + locked)
       ├─ If mismatch: Update DB to match on-chain
       └─ Log discrepancy
   ↓
3. Get trades pending settlement > 5 minutes
   ↓
4. For each pending trade:
   ├─ If has tx hash: Verify on-chain
   ├─ If settled: Update DB status to 'SETTLED'
   ├─ If no tx hash: Flag for investigation
   └─ Log discrepancy
   ↓
5. Return reconciliation result:
   {
     tokensChecked: number,
     balancesChecked: number,
     discrepanciesFound: number,
     discrepancies: Array<{
       type: 'balance' | 'trade_settlement',
       action: 'updated' | 'flagged',
       ...details
     }>
   }
```

### Sapphire RPC Methods

The reconciliation service uses these Sapphire RPC methods:

```typescript
// Get total supply
sapphire_getTotalSupply(contractAddress)
  → Returns: { totalSupply: string }

// Get user balance
sapphire_getBalance(contractAddress, userAddress)
  → Returns: { balance: string }

// Get transaction status
sapphire_getTransactionStatus(txHash)
  → Returns: { confirmed: boolean, status: 'success' | 'failed' }
```

### Monitoring

Reconciliation results are logged with:
- Tokens checked
- Balances checked
- Discrepancies found
- Details of each discrepancy

**Example Log**:
```json
{
  "level": "info",
  "message": "Blockchain reconciliation completed",
  "tokensChecked": 5,
  "balancesChecked": 127,
  "discrepanciesFound": 2,
  "timestamp": "2025-11-28T12:00:00Z"
}
```

---

## 5. Complete Trading Flow for RWA

### Example: User Buys RWA Token

**Step 1: Market is Active**
```
Market: "Luxury Apartment Complex"
Status: active
Token: LUXAPT (deployed to Sapphire)
Trading Pair: LUXAPT-USDC (auto-created)
```

**Step 2: User Places Order**
```bash
POST /api/v1/trading/orders
{
  "userId": "user-123",
  "userAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "tradingPairId": "luxapt-usdc-pair-id",
  "side": "BUY",
  "orderKind": "LIMIT",
  "quantity": "100",
  "price": "50.00",
  "signature": "0x...",
  "nonce": "1701388800-xyz789",
  "expiry": 1701392400
}
```

**Step 3: Backend Processing**
```
1. Validate EIP-712 signature ✓
2. Check nonce not used ✓
3. Validate expiry ✓
4. Find trading pair ✓
5. Check if linked to market (marketId exists) ✓
6. Validate RWA compliance:
   ├─ Market status: active ✓
   ├─ User KYC: APPROVED ✓
   ├─ User whitelist: true ✓
   └─ User accreditation: APPROVED ✓
7. Lock 5,000 USDC from user ✓
8. Create order (status: OPEN) ✓
9. Publish 'order.created' event ✓
10. Try matching with SELL orders ✓
11. Match found at $49.50 (better price!) ✓
12. Execute trade (PostgreSQL transaction):
    ├─ Buyer: -4,950 USDC, +100 LUXAPT
    ├─ Seller: -100 LUXAPT, +4,950 USDC
    ├─ Fees deducted from both
    └─ Trade record created
13. Publish 'trade.executed' event ✓
14. Enqueue settlement job (BullMQ) ✓
```

**Step 4: Async Settlement**
```
Settlement Worker:
1. Pick up job from queue
2. Call Sapphire RPC:
   sapphire_settleTrade({
     tradeId: "trade-456",
     tradingPairId: "luxapt-usdc-pair-id"
   })
3. Receive tx hash: 0xabcd...
4. Update trade:
   settlement_status: 'SETTLED'
   blockchain_tx_hash: '0xabcd...'
5. Publish 'trade.settled' event ✓
```

**Step 5: Reconciliation (15 min later)**
```
Reconciliation Worker:
1. Check LUXAPT token balances
   ├─ User 1: DB=100, On-chain=100 ✓
   ├─ User 2: DB=900, On-chain=900 ✓
   └─ No discrepancies
2. Check pending settlements
   └─ No trades pending > 5 minutes ✓
3. Result: Everything in sync ✓
```

---

## 6. Database Schema Changes

### Migration: 005_trading_pairs_market_link.ts

```sql
-- Add market_id to trading_pairs
ALTER TABLE trading_pairs
ADD COLUMN market_id UUID REFERENCES markets(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX idx_trading_pairs_market_id ON trading_pairs(market_id);
```

### Updated Schema

**trading_pairs** table:
```sql
id UUID PRIMARY KEY
market_id UUID REFERENCES markets(id)  -- NEW: Links to RWA market
base_token_id UUID REFERENCES tokens(id)
quote_token_id UUID REFERENCES tokens(id)
pair_symbol VARCHAR(50)
is_active BOOLEAN DEFAULT true
min_order_size NUMERIC
max_order_size NUMERIC
price_precision INTEGER
quantity_precision INTEGER
metadata JSONB
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

## 7. Configuration

### Environment Variables

```bash
# Worker Concurrency
WORKER_CONCURRENCY=5

# Reconciliation (automatic)
# Runs every 15 minutes via BullMQ cron

# Sapphire RPC (for reconciliation)
SAPPHIRE_RPC_URL=https://sapphire.oasis.io
SAPPHIRE_CHAIN_ID=sapphire-localnet
```

---

## 8. API Endpoints

### Get Trading Pairs for Market

```bash
GET /api/v1/trading/pairs?marketId={marketId}
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "pair-uuid",
      "marketId": "market-uuid",
      "pairSymbol": "LUXAPT-USDC",
      "baseTokenId": "luxapt-token-id",
      "quoteTokenId": "usdc-token-id",
      "isActive": true,
      "minOrderSize": "1",
      "maxOrderSize": "1000000"
    }
  ]
}
```

### Place Order (with RWA Compliance)

```bash
POST /api/v1/trading/orders
```

**Request**: Same as before (with signature)

**New Error Responses**:
```json
// Market not active
{
  "error": "Market is not active for trading",
  "code": "market_not_active",
  "statusCode": 400,
  "details": {
    "marketStatus": "paused"
  }
}

// Compliance failed
{
  "error": "User does not meet RWA compliance requirements",
  "code": "compliance_failed",
  "statusCode": 403,
  "details": {
    "reason": "User not whitelisted for this token",
    "tokenSymbol": "LUXAPT",
    "assetType": "real_estate"
  }
}
```

---

## 9. Monitoring & Alerting

### Key Metrics

**Market Activation**:
- Time to activate market (should be < 1 minute)
- Trading pair creation success rate (should be 100%)

**Compliance Checks**:
- Compliance check latency (target: < 50ms with caching)
- Compliance rejection rate per asset type

**Reconciliation**:
- Reconciliation execution time (target: < 5 minutes)
- Discrepancies found per run
- Balance correction rate
- Pending settlement resolution rate

### Logs to Monitor

```javascript
// Trading pair created
logger.info({ tradingPairId, pairSymbol, marketId }, 'Trading pair created for RWA market');

// Compliance validated
logger.debug({ userId, marketId, tokenSymbol }, 'RWA compliance validated');

// Compliance failed
logger.warn({ userId, tokenId, marketId, error }, 'RWA compliance check failed');

// Reconciliation completed
logger.info({
  tokensChecked,
  balancesChecked,
  discrepanciesFound
}, 'Blockchain reconciliation completed');

// Discrepancies found
logger.warn({ discrepancies }, 'Blockchain discrepancies detected and processed');
```

---

## 10. Files Changed/Created

### Created (6 files)
1. `src/services/usdcTokenService.ts` - USDC token management
2. `src/services/blockchainReconciliationService.ts` - Reconciliation logic
3. `src/infra/queue/reconciliationWorkerHandler.ts` - Reconciliation worker
4. `src/infra/database/migrations/005_trading_pairs_market_link.ts` - Migration
5. `RWA_TRADING_INTEGRATION.md` - This documentation

### Updated (7 files)
1. `src/types/trading.ts` - Added marketId to TradingPair
2. `src/infra/database/repositories/tradingRepository.ts` - Added createTradingPair, findTradingPairByMarketId
3. `src/infra/queue/tokenDeploymentHandler.ts` - Auto-create trading pairs
4. `src/services/tradingService.ts` - Added RWA compliance validation
5. `src/infra/queue/index.ts` - Added reconciliation queue
6. `src/infra/bootstrap.ts` - Initialize reconciliation worker
7. `TRADING_SYSTEM_IMPLEMENTATION.md` - Updated documentation

---

## 11. Testing Recommendations

### Integration Tests

**Test 1: Market Activation Creates Trading Pair**
```typescript
1. Create and approve market
2. Activate market (trigger deployment)
3. Wait for activation completion
4. Verify trading pair exists
5. Verify pair linked to market
6. Verify USDC token exists
```

**Test 2: RWA Compliance Enforcement**
```typescript
1. Create active RWA market with trading pair
2. User without KYC tries to place order
3. Verify order rejected with compliance_failed
4. Approve user KYC
5. User places order successfully
```

**Test 3: Blockchain Reconciliation**
```typescript
1. Create trades and settle on-chain
2. Manually create DB/on-chain mismatch
3. Trigger reconciliation
4. Verify mismatch detected
5. Verify DB updated to match on-chain
6. Verify discrepancy logged
```

---

## 12. Troubleshooting

### Trading Pair Not Created

**Symptoms**: Market activated but no trading pair

**Check**:
1. Token deployment logs - did it complete?
2. USDC token exists in database
3. No errors in tokenDeploymentHandler logs

**Solution**: Manually create trading pair or retry activation

### Compliance Always Failing

**Symptoms**: All orders rejected with compliance_failed

**Check**:
1. User has compliance record in compliance_records table
2. kycStatus is 'APPROVED'
3. whitelistStatus is true
4. expiryDate is not passed

**Solution**: Update compliance record or request KYC approval

### Reconciliation Finding Many Discrepancies

**Symptoms**: Every reconciliation finds mismatches

**Check**:
1. Sapphire RPC connectivity
2. Settlement worker processing trades
3. Balance updates happening correctly

**Solution**: Investigate root cause of mismatches (likely settlement failures)

---

## Summary

The RWA trading integration provides:

✅ **Automatic Trading Pair Creation** - Markets become tradeable immediately upon activation
✅ **RWA Compliance Enforcement** - KYC/whitelist checks for all RWA trades
✅ **USDC Quote Currency** - All RWA tokens trade against USDC
✅ **Blockchain Reconciliation** - Automatic DB sync with on-chain state every 15 minutes
✅ **Complete Audit Trail** - Events published for all actions
✅ **Scalable Architecture** - BullMQ workers, Redis caching, PostgreSQL ACID transactions

**Total Implementation Time**: ~4 hours
**Files Created/Modified**: 13 files
**New Database Tables**: 0 (only added 1 column)
**New BullMQ Workers**: 1 (reconciliation)

---

**Implementation Complete**: November 28, 2025
