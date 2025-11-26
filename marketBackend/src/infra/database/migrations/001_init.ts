import { getDatabasePool } from '@infra/database';

export const migrationId = '001_init';

export const up = async (): Promise<void> => {
  const pool = getDatabasePool();

  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS markets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      onchain_market_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT,
      error_reason TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS market_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      tx_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (market_id, tx_hash, event_type)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_market_status
      ON transactions (market_id, status);

    CREATE INDEX IF NOT EXISTS idx_market_events_market
      ON market_events (market_id, occurred_at DESC);
  `);
};

export const down = async (): Promise<void> => {
  const pool = getDatabasePool();
  await pool.query(`
    DROP TABLE IF EXISTS market_events;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS markets;
  `);
};
