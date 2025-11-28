import { Pool } from 'pg';

/**
 * Migration: Processed Events Tracking
 *
 * Purpose: Track events received from external systems to ensure idempotency
 * and prevent duplicate processing of approval decisions, blockchain events, etc.
 *
 * This table is critical for:
 * - Webhook idempotency (prevent processing same event twice)
 * - Event replay protection
 * - Audit trail of external events
 */
export async function up(pool: Pool): Promise<void> {
  await pool.query(`
    -- Processed Events Table
    -- Stores events received from external systems to ensure idempotency
    CREATE TABLE IF NOT EXISTS processed_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id VARCHAR(128) UNIQUE NOT NULL,
      event_type VARCHAR(128) NOT NULL,
      source VARCHAR(128) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      context JSONB NOT NULL DEFAULT '{}',
      processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processing_status VARCHAR(50) NOT NULL DEFAULT 'success',
      processing_error TEXT,

      -- Indexes for fast lookups
      CONSTRAINT processed_events_status_check
        CHECK (processing_status IN ('success', 'failed', 'skipped'))
    );

    -- Index for checking if event has been processed
    CREATE INDEX IF NOT EXISTS idx_processed_events_event_id
      ON processed_events(event_id);

    -- Index for querying by event type and source
    CREATE INDEX IF NOT EXISTS idx_processed_events_type_source
      ON processed_events(event_type, source);

    -- Index for querying by processing time
    CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
      ON processed_events(processed_at DESC);

    -- Index for failed events that may need retry
    CREATE INDEX IF NOT EXISTS idx_processed_events_failed
      ON processed_events(processing_status, processed_at)
      WHERE processing_status = 'failed';
  `);

  console.log('✅ Migration 004: Processed events tracking table created');
}

export async function down(pool: Pool): Promise<void> {
  await pool.query(`
    DROP INDEX IF EXISTS idx_processed_events_failed;
    DROP INDEX IF EXISTS idx_processed_events_processed_at;
    DROP INDEX IF EXISTS idx_processed_events_type_source;
    DROP INDEX IF EXISTS idx_processed_events_event_id;
    DROP TABLE IF EXISTS processed_events;
  `);

  console.log('✅ Migration 004: Processed events tracking table dropped');
}
