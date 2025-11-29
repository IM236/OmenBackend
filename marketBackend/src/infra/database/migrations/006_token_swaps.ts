import { getDatabasePool } from '@infra/database';

export const migrationId = '006_token_swaps';

export const up = async (): Promise<void> => {
  const pool = getDatabasePool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_swaps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      source_token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      target_token_id UUID NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
      source_chain TEXT NOT NULL,
      target_chain TEXT NOT NULL,
      source_amount NUMERIC(78, 0) NOT NULL,
      expected_target_amount NUMERIC(78, 0) NOT NULL,
      destination_address TEXT NOT NULL,
      bridge_contract_address TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')) DEFAULT 'PENDING',
      sapphire_swap_id TEXT,
      source_tx_hash TEXT,
      target_tx_hash TEXT,
      failure_reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_token_swaps_user
      ON token_swaps(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_token_swaps_status
      ON token_swaps(status)
      WHERE status IN ('PENDING', 'QUEUED', 'PROCESSING');
  `);
};

export const down = async (): Promise<void> => {
  const pool = getDatabasePool();
  await pool.query(`
    DROP TABLE IF EXISTS token_swaps;
  `);
};
