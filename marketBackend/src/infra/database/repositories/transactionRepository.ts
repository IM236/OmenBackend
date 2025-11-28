import { randomUUID } from 'crypto';

import { getDatabasePool } from '@infra/database';
import { TransactionRecord, TransactionStatus } from '@app-types/transaction';

interface CreateTransactionInput {
  marketId: string;
  status: TransactionStatus;
  payload: Record<string, unknown>;
  jobId?: string;
}

interface UpdateStatusInput {
  id: string;
  status: TransactionStatus;
  txHash?: string;
  errorReason?: string;
}

const mapRowToTransaction = (row: any): TransactionRecord => ({
  id: row.id,
  marketId: row.market_id,
  jobId: row.job_id,
  status: row.status,
  txHash: row.tx_hash ?? undefined,
  errorReason: row.error_reason ?? undefined,
  payload: row.payload,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const createTransaction = async (
  input: CreateTransactionInput
): Promise<TransactionRecord> => {
  const pool = getDatabasePool();
  const id = randomUUID();
  const jobId = input.jobId ?? id;

  const result = await pool.query(
    `
    INSERT INTO transactions (id, market_id, status, payload, job_id)
    VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING *
    `,
    [id, input.marketId, input.status, JSON.stringify(input.payload), jobId]
  );

  return mapRowToTransaction(result.rows[0]);
};

export const updateTransactionStatus = async (
  input: UpdateStatusInput
): Promise<TransactionRecord> => {
  const pool = getDatabasePool();

  const result = await pool.query(
    `
    UPDATE transactions
    SET status = $2,
        tx_hash = COALESCE($3, tx_hash),
        error_reason = COALESCE($4, error_reason),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [input.id, input.status, input.txHash ?? null, input.errorReason ?? null]
  );

  if (result.rowCount === 0) {
    throw new Error(`Transaction ${input.id} not found`);
  }

  return mapRowToTransaction(result.rows[0]);
};

export const findTransactionById = async (
  id: string
): Promise<TransactionRecord | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]);
};

export const findTransactionsByMarketId = async (
  marketId: string
): Promise<TransactionRecord[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM transactions WHERE market_id = $1 ORDER BY created_at DESC',
    [marketId]
  );
  return result.rows.map(mapRowToTransaction);
};
