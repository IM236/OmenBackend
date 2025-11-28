# Async Approval Flow Implementation

## Summary

The market approval flow has been refactored from a blocking synchronous pattern to a fully asynchronous event-driven architecture. This resolves the blocking issue where `registerMarket()` would wait indefinitely for approval decisions.

## Key Changes

### 1. Non-Blocking Registration

**Before**: `registerMarket()` blocked waiting for approval
```typescript
await this.requestApproval(market.id, input.entityId, admin);
// ❌ This would block if approval took hours/days
```

**After**: Returns immediately after saving to database
```typescript
// Request approval (non-blocking - just updates status and publishes event)
await this.requestApproval(market.id, input.entityId, admin);

// Return immediately - approval will happen asynchronously ✓
return { market, asset };
```

### 2. Webhook Integration

Created webhook endpoint to receive approval decisions from Entity_Permissions_Core:

**Endpoint**: `POST /api/v1/webhooks/entity-permissions`

**Features**:
- Handles SNS message format or direct HTTP webhooks
- Idempotency via `processed_events` table
- Validates event structure
- Routes to appropriate handlers
- Records all events for audit

### 3. Polling Fallback

Enhanced `MarketEventListener` to poll Entity_Permissions_Core API:

**Mechanism**: Polls `/api/v1/events` every 10 seconds
**Use Case**: Development/testing without webhook infrastructure
**Features**:
- Fetches unprocessed events
- Prevents duplicates via `processed_events` table
- Handles both approval and rejection events

### 4. Event Tracking

New `processed_events` table ensures idempotency:

**Purpose**: Prevent duplicate processing of external events
**Fields**:
- `event_id`: Unique identifier from external system
- `event_type`: market.approved, market.rejected, etc.
- `source`: entity_permissions_core, sapphire, etc.
- `processing_status`: success | failed | skipped
- `processing_error`: Error message if failed

## Files Created

1. **src/controllers/webhookController.ts**
   - `handleEntityPermissionsWebhook()` - Main webhook handler
   - `webhookHealthCheck()` - Health endpoint
   - SNS message parsing
   - Idempotency checks
   - Error handling and logging

2. **src/routes/webhookRouter.ts**
   - Webhook route definitions
   - Maps to webhook controller

3. **src/infra/database/migrations/004_processed_events_tracking.ts**
   - Creates `processed_events` table
   - Indexes for fast lookups
   - Constraints for data integrity

4. **src/infra/database/repositories/processedEventRepository.ts**
   - `isEventProcessed()` - Check if event already handled
   - `recordProcessedEvent()` - Record event with status
   - `findProcessedEventById()` - Retrieve event
   - `listProcessedEvents()` - Query with filters
   - `getFailedEventsCount()` - Monitoring helper
   - `deleteOldProcessedEvents()` - Cleanup utility

## Files Modified

1. **src/services/marketService.ts**
   - Removed blocking wait in `registerMarket()`
   - Added comments clarifying async behavior
   - No changes to approval logic

2. **src/services/eventListenerService.ts**
   - Added `pollEntityPermissionsEvents()` - Polls for approval events
   - Added `processEntityPermissionEvent()` - Processes single event
   - Integrated with `processed_events` tracking
   - 10-second polling interval

3. **src/routes/apiRouter.ts**
   - Added webhook routes to main API router

4. **IMPLEMENTATION_SUMMARY.md**
   - Added "Async Approval Architecture" section
   - Documented flow overview
   - Listed integration methods (webhook vs polling)
   - Updated checklist with completed items

5. **ARCHITECTURE.md**
   - Updated registration flow diagram
   - Added async markers to all steps
   - Added "Event Processing Guarantees" section
   - Documented idempotency, ordering, failure handling
   - Added webhook endpoints table

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│ 1. Issuer calls POST /markets/register                  │
│    → Market saved (status: pending_approval)            │
│    → Events published                                    │
│    → Response returned immediately ✓                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. [ASYNC] Admin reviews in Entity_Permissions_Core     │
│    → Time: Minutes to days (human decision)             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. [ASYNC] Entity_Permissions_Core publishes event      │
│    → SNS Topic: market.approved OR market.rejected      │
└─────────────────────────────────────────────────────────┘
                          ↓
         ┌────────────────┴────────────────┐
         ↓                                  ↓
┌─────────────────────┐      ┌──────────────────────────┐
│ 4a. Webhook Handler │  OR  │ 4b. Polling Listener     │
│ (Real-time)         │      │ (Every 10s)              │
└─────────────────────┘      └──────────────────────────┘
         ↓                                  ↓
         └────────────────┬─────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Check processed_events (idempotency)                 │
│    → If already processed, skip                          │
│    → Else, process and record                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Update market status                                  │
│    → If approved: trigger token deployment               │
│    → If rejected: store reason                           │
└─────────────────────────────────────────────────────────┘
```

## Integration Options

### Option 1: Webhooks (Production)

**Setup**:
1. Deploy marketBackend with public endpoint
2. Configure SNS subscription:
   - Topic: Entity_Permissions_Core event topic
   - Endpoint: `https://your-domain.com/api/v1/webhooks/entity-permissions`
   - Protocol: HTTPS

**Advantages**:
- Real-time (< 1 second latency)
- No polling overhead
- Built-in retry via SNS
- Scales automatically

**Test Command**:
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/entity-permissions \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-123",
    "event_type": "market.approved",
    "source": "entity_permissions_core",
    "payload": {
      "market_id": "your-market-uuid",
      "entity_id": "your-entity-uuid",
      "decision": "approved"
    },
    "context": {
      "actor_id": "admin-uuid"
    }
  }'
```

### Option 2: API Polling (Development/Fallback)

**Setup**:
1. Set environment variable: `PERMISSIONS_SERVICE_BASE_URL=http://localhost:8000`
2. Start MarketEventListener (auto-starts with app)

**Advantages**:
- No infrastructure setup
- Works in development
- Good for testing
- Fallback if webhooks fail

**Configuration** (.env):
```bash
PERMISSIONS_SERVICE_BASE_URL=http://localhost:8000
PERMISSIONS_SERVICE_API_KEY=your-api-key
PERMISSIONS_SERVICE_TIMEOUT_MS=5000
```

## Testing

### 1. Test Registration (Non-Blocking)

```bash
POST http://localhost:3000/api/v1/markets/register
{
  "name": "Test Market",
  "issuerId": "issuer-uuid",
  "assetType": "real_estate",
  "tokenSymbol": "TEST",
  "tokenName": "Test Token",
  "totalSupply": 1000000,
  "entityId": "entity-uuid",
  "assetDetails": {}
}

# Should return immediately with status: "pending_approval"
# Do NOT wait for approval
```

### 2. Test Webhook (Simulate Approval)

```bash
POST http://localhost:3000/api/v1/webhooks/entity-permissions
{
  "event_id": "test-approval-123",
  "event_type": "market.approved",
  "source": "entity_permissions_core",
  "payload": {
    "market_id": "market-uuid-from-step-1",
    "entity_id": "entity-uuid",
    "decision": "approved"
  },
  "context": {
    "actor_id": "admin-uuid"
  }
}

# Should process approval and activate market
# Check: GET /api/v1/markets/{market-id}
# Status should be: "active"
```

### 3. Test Idempotency

```bash
# Send same webhook twice
# First call: Processes approval
# Second call: Returns 200 with status "already_processed"
```

### 4. Test Polling

```bash
# Enable polling in .env
# Wait 10 seconds
# Check logs for "Polled events from Entity Permissions Core"
```

### 5. View Processed Events

```bash
# Query processed events
psql -d marketdb -c "SELECT event_id, event_type, processing_status, processed_at FROM processed_events ORDER BY processed_at DESC LIMIT 10;"
```

## Monitoring

### Key Metrics

1. **Event Processing Success Rate**
   ```sql
   SELECT
     processing_status,
     COUNT(*) as count,
     COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
   FROM processed_events
   WHERE processed_at > NOW() - INTERVAL '24 hours'
   GROUP BY processing_status;
   ```

2. **Failed Events**
   ```sql
   SELECT event_id, event_type, processing_error, processed_at
   FROM processed_events
   WHERE processing_status = 'failed'
   ORDER BY processed_at DESC;
   ```

3. **Webhook Latency**
   - Monitor time between event creation and processing
   - Track in `market_approval_events` table

### Alerts

- **Critical**: Failed event processing > 5% in last hour
- **Warning**: No events received in last 30 minutes (if expecting traffic)
- **Info**: Polling enabled (suggests webhook not configured)

## Migration Steps

### 1. Run Database Migration

```bash
cd /Users/gilgamesh/OmenBackEnd/marketBackend
npm run migrate
```

This will execute `004_processed_events_tracking.ts` and create the `processed_events` table.

### 2. Update Environment Variables

```bash
# For webhook mode (production)
# No additional env vars needed - webhook works out of the box

# For polling mode (development)
PERMISSIONS_SERVICE_BASE_URL=http://localhost:8000
PERMISSIONS_SERVICE_API_KEY=your-api-key
PERMISSIONS_SERVICE_TIMEOUT_MS=5000
```

### 3. Deploy Changes

```bash
# Restart application
npm run dev  # or npm start for production
```

### 4. Verify Health

```bash
# Check webhook health
curl http://localhost:3000/api/v1/webhooks/health

# Expected response:
# {
#   "status": "ok",
#   "service": "webhook-handler",
#   "timestamp": "2025-12-15T..."
# }
```

## Rollback Plan

If issues arise, rollback is straightforward:

1. **Code Rollback**: Git revert to previous commit
2. **Database**: `processed_events` table doesn't affect existing functionality
3. **No Breaking Changes**: Existing API endpoints unchanged

The changes are additive and don't modify core business logic.

## Benefits

✅ **Non-Blocking**: Registration returns immediately
✅ **Scalable**: Async processing handles high volumes
✅ **Reliable**: Idempotency prevents duplicate processing
✅ **Flexible**: Webhook OR polling integration
✅ **Observable**: Full audit trail in `processed_events`
✅ **Testable**: Easy to simulate with curl

## Next Steps

1. **Production Webhook Setup**:
   - Configure SNS subscription
   - Test with staging environment
   - Monitor event delivery

2. **Error Handling Enhancements**:
   - Add retry logic for failed events
   - Admin UI for manual event replay
   - Alerting on processing failures

3. **Performance Optimization**:
   - Add caching for frequently accessed markets
   - Batch event processing if high volume
   - Consider SQS consumer for scale

4. **Security**:
   - Add webhook signature validation (SNS message signature)
   - Rate limiting on webhook endpoint
   - IP whitelist for Entity_Permissions_Core

---

**Implementation Complete**: ✅
**Production Ready**: After webhook configuration
**Estimated Setup Time**: 30 minutes (webhook config) or 5 minutes (polling mode)
