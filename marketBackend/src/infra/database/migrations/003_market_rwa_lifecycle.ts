import { getDatabasePool } from '@infra/database';

export const migrationId = '003_market_rwa_lifecycle';

export const up = async (): Promise<void> => {
  const pool = getDatabasePool();

  await pool.query(`
    -- Add asset_type and issuer fields to markets
    ALTER TABLE markets
      ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'real_estate',
      ADD COLUMN IF NOT EXISTS issuer_id UUID,
      ADD COLUMN IF NOT EXISTS contract_address TEXT,
      ADD COLUMN IF NOT EXISTS deployment_tx_hash TEXT,
      ADD COLUMN IF NOT EXISTS token_symbol TEXT,
      ADD COLUMN IF NOT EXISTS token_name TEXT,
      ADD COLUMN IF NOT EXISTS total_supply NUMERIC(20, 2),
      ADD COLUMN IF NOT EXISTS approved_by UUID,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

    -- Create enum for asset types
    DO $$ BEGIN
      CREATE TYPE asset_type_enum AS ENUM (
        'real_estate',
        'corporate_stock',
        'government_bond',
        'commodity',
        'private_equity',
        'art_collectible',
        'carbon_credit',
        'other'
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    -- Update markets status to include new lifecycle states
    DO $$ BEGIN
      CREATE TYPE market_status_enum AS ENUM (
        'draft',
        'pending_approval',
        'approved',
        'rejected',
        'activating',
        'active',
        'paused',
        'archived'
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    -- Create market approval events table
    CREATE TABLE IF NOT EXISTS market_approval_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor_id UUID NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'admin',
      decision TEXT,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT valid_event_type CHECK (event_type IN (
        'market.registered',
        'market.approval_requested',
        'market.approved',
        'market.rejected',
        'market.activation_started',
        'market.activated',
        'market.paused',
        'market.archived'
      ))
    );

    -- Create market assets table for detailed RWA information
    CREATE TABLE IF NOT EXISTS market_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      market_id UUID NOT NULL UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
      asset_type asset_type_enum NOT NULL,
      valuation NUMERIC(20, 2),
      currency TEXT DEFAULT 'USD',
      location TEXT,
      description TEXT,
      compliance_documents JSONB DEFAULT '[]'::jsonb,
      regulatory_info JSONB DEFAULT '{}'::jsonb,
      attributes JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Create indexes for efficient querying
    CREATE INDEX IF NOT EXISTS idx_markets_asset_type
      ON markets (asset_type);

    CREATE INDEX IF NOT EXISTS idx_markets_issuer_id
      ON markets (issuer_id);

    CREATE INDEX IF NOT EXISTS idx_markets_status_asset_type
      ON markets (status, asset_type);

    CREATE INDEX IF NOT EXISTS idx_market_approval_events_market
      ON market_approval_events (market_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_market_approval_events_type
      ON market_approval_events (event_type, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_market_assets_asset_type
      ON market_assets (asset_type);
  `);
};

export const down = async (): Promise<void> => {
  const pool = getDatabasePool();
  await pool.query(`
    DROP TABLE IF EXISTS market_assets;
    DROP TABLE IF EXISTS market_approval_events;

    ALTER TABLE markets
      DROP COLUMN IF EXISTS asset_type,
      DROP COLUMN IF EXISTS issuer_id,
      DROP COLUMN IF EXISTS contract_address,
      DROP COLUMN IF EXISTS deployment_tx_hash,
      DROP COLUMN IF EXISTS token_symbol,
      DROP COLUMN IF EXISTS token_name,
      DROP COLUMN IF EXISTS total_supply,
      DROP COLUMN IF EXISTS approved_by,
      DROP COLUMN IF EXISTS approved_at,
      DROP COLUMN IF EXISTS activated_at,
      DROP COLUMN IF EXISTS rejected_reason;

    DROP TYPE IF EXISTS asset_type_enum CASCADE;
    DROP TYPE IF EXISTS market_status_enum CASCADE;
  `);
};
