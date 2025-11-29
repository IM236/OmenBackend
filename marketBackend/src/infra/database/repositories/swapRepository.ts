import { getDatabasePool } from '@infra/database';
import { SwapRecord, SwapStatus, CreateSwapInput } from '@app-types/swap';

const mapRowToSwap = (row: any): SwapRecord => ({
  id: row.id,
  userId: row.user_id,
  sourceTokenId: row.source_token_id,
  targetTokenId: row.target_token_id,
  sourceChain: row.source_chain,
  targetChain: row.target_chain,
  sourceAmount: row.source_amount,
  expectedTargetAmount: row.expected_target_amount,
  destinationAddress: row.destination_address,
  bridgeContractAddress: row.bridge_contract_address,
  status: row.status,
  sapphireSwapId: row.sapphire_swap_id,
  sourceTxHash: row.source_tx_hash,
  targetTxHash: row.target_tx_hash,
  failureReason: row.failure_reason,
  metadata: row.metadata || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at
});

export const createSwapRequest = async (input: CreateSwapInput): Promise<SwapRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      INSERT INTO token_swaps (
        user_id,
        source_token_id,
        target_token_id,
        source_chain,
        target_chain,
        source_amount,
        expected_target_amount,
        destination_address,
        bridge_contract_address,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10::jsonb)
      RETURNING *
    `,
    [
      input.userId,
      input.sourceTokenId,
      input.targetTokenId,
      input.sourceChain,
      input.targetChain,
      input.sourceAmount,
      input.quote?.expectedTargetAmount ?? input.sourceAmount,
      input.destinationAddress,
      input.bridgeContractAddress,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return mapRowToSwap(result.rows[0]);
};

export const updateSwapStatus = async (
  swapId: string,
  status: SwapStatus
): Promise<SwapRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      UPDATE token_swaps
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [swapId, status]
  );

  if (result.rowCount === 0) {
    throw new Error(`Swap ${swapId} not found`);
  }

  return mapRowToSwap(result.rows[0]);
};

export const markSwapProcessing = async (
  swapId: string,
  sapphireSwapId: string | null,
  sourceTxHash: string | null
): Promise<SwapRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      UPDATE token_swaps
      SET status = 'PROCESSING',
          sapphire_swap_id = COALESCE($2, sapphire_swap_id),
          source_tx_hash = COALESCE($3, source_tx_hash),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [swapId, sapphireSwapId, sourceTxHash]
  );

  if (result.rowCount === 0) {
    throw new Error(`Swap ${swapId} not found`);
  }

  return mapRowToSwap(result.rows[0]);
};

export const markSwapCompleted = async (
  swapId: string,
  targetTxHash: string | null,
  expectedTargetAmount: string
): Promise<SwapRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      UPDATE token_swaps
      SET status = 'COMPLETED',
          target_tx_hash = COALESCE($2, target_tx_hash),
          expected_target_amount = $3,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [swapId, targetTxHash, expectedTargetAmount]
  );

  if (result.rowCount === 0) {
    throw new Error(`Swap ${swapId} not found`);
  }

  return mapRowToSwap(result.rows[0]);
};

export const markSwapFailed = async (
  swapId: string,
  failureReason: string
): Promise<SwapRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      UPDATE token_swaps
      SET status = 'FAILED',
          failure_reason = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [swapId, failureReason]
  );

  if (result.rowCount === 0) {
    throw new Error(`Swap ${swapId} not found`);
  }

  return mapRowToSwap(result.rows[0]);
};

export const findSwapById = async (swapId: string): Promise<SwapRecord | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM token_swaps WHERE id = $1', [swapId]);
  return result.rowCount > 0 ? mapRowToSwap(result.rows[0]) : null;
};

export const listSwapsByUser = async (
  userId: string,
  limit = 50
): Promise<SwapRecord[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      SELECT *
      FROM token_swaps
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map(mapRowToSwap);
};

export const listRecentSwaps = async (limit = 100): Promise<SwapRecord[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
      SELECT *
      FROM token_swaps
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map(mapRowToSwap);
};
