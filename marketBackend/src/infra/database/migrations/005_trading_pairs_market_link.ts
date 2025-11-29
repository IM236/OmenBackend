import { Pool } from 'pg';

/**
 * Migration: Add market_id to trading_pairs table
 *
 * Links trading pairs to their source RWA markets
 */
export const up = async (pool: Pool): Promise<void> => {
  await pool.query(`
    -- Add market_id column to trading_pairs table
    ALTER TABLE trading_pairs
    ADD COLUMN market_id UUID REFERENCES markets(id) ON DELETE SET NULL;

    -- Create index for market_id lookups
    CREATE INDEX idx_trading_pairs_market_id ON trading_pairs(market_id);

    -- Add comment
    COMMENT ON COLUMN trading_pairs.market_id IS 'Links trading pair to the RWA market that created it';
  `);
};

export const down = async (pool: Pool): Promise<void> => {
  await pool.query(`
    -- Drop index
    DROP INDEX IF EXISTS idx_trading_pairs_market_id;

    -- Remove market_id column
    ALTER TABLE trading_pairs
    DROP COLUMN IF EXISTS market_id;
  `);
};
