import { randomUUID } from 'crypto';

import { getDatabasePool } from '@infra/database';
import { Market, MarketFilters, MarketListResponse, MarketStatus, AssetType } from '@app-types/market';

const mapRowToMarket = (row: any): Market => ({
  id: row.id,
  name: row.name,
  ownerId: row.owner_id,
  issuerId: row.issuer_id,
  assetType: row.asset_type,
  status: row.status,
  contractAddress: row.contract_address,
  deploymentTxHash: row.deployment_tx_hash,
  tokenSymbol: row.token_symbol,
  tokenName: row.token_name,
  totalSupply: row.total_supply ? parseFloat(row.total_supply) : undefined,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  activatedAt: row.activated_at,
  rejectedReason: row.rejected_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  metadata: row.metadata
});

export interface CreateMarketInput {
  name: string;
  ownerId: string;
  issuerId?: string;
  assetType: AssetType;
  tokenSymbol?: string;
  tokenName?: string;
  totalSupply?: number;
  metadata: Record<string, unknown>;
}

export const createMarket = async (input: CreateMarketInput): Promise<Market> => {
  const pool = getDatabasePool();
  const id = randomUUID();

  const result = await pool.query(
    `
    INSERT INTO markets (
      id, name, owner_id, issuer_id, asset_type, token_symbol,
      token_name, total_supply, status, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9::jsonb)
    RETURNING *
    `,
    [
      id,
      input.name,
      input.ownerId,
      input.issuerId || null,
      input.assetType,
      input.tokenSymbol || null,
      input.tokenName || null,
      input.totalSupply || null,
      JSON.stringify(input.metadata)
    ]
  );

  return mapRowToMarket(result.rows[0]);
};

export const updateMarketStatus = async (
  marketId: string,
  status: MarketStatus,
  metadata: Record<string, unknown> = {}
): Promise<Market> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    UPDATE markets
    SET status = $2,
        metadata = metadata || $3::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [marketId, status, JSON.stringify(metadata)]
  );

  if (result.rowCount === 0) {
    throw new Error(`Market ${marketId} not found`);
  }

  return mapRowToMarket(result.rows[0]);
};

export const approveMarket = async (
  marketId: string,
  approvedBy: string
): Promise<Market> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    UPDATE markets
    SET status = 'approved',
        approved_by = $2,
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [marketId, approvedBy]
  );

  if (result.rowCount === 0) {
    throw new Error(`Market ${marketId} not found`);
  }

  return mapRowToMarket(result.rows[0]);
};

export const rejectMarket = async (
  marketId: string,
  reason: string
): Promise<Market> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    UPDATE markets
    SET status = 'rejected',
        rejected_reason = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [marketId, reason]
  );

  if (result.rowCount === 0) {
    throw new Error(`Market ${marketId} not found`);
  }

  return mapRowToMarket(result.rows[0]);
};

export const activateMarket = async (
  marketId: string,
  contractAddress: string,
  deploymentTxHash: string
): Promise<Market> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    UPDATE markets
    SET status = 'active',
        contract_address = $2,
        deployment_tx_hash = $3,
        activated_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [marketId, contractAddress, deploymentTxHash]
  );

  if (result.rowCount === 0) {
    throw new Error(`Market ${marketId} not found`);
  }

  return mapRowToMarket(result.rows[0]);
};

export const findMarketById = async (marketId: string): Promise<Market | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM markets WHERE id = $1', [marketId]);
  if (result.rowCount === 0) {
    return null;
  }

  return mapRowToMarket(result.rows[0]);
};

export const listMarkets = async (filters: MarketFilters): Promise<MarketListResponse> => {
  const pool = getDatabasePool();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    whereClauses.push(`status = $${params.length}`);
  }

  if (filters.ownerId) {
    params.push(filters.ownerId);
    whereClauses.push(`owner_id = $${params.length}`);
  }

  if (filters.createdAfter) {
    params.push(filters.createdAfter);
    whereClauses.push(`created_at >= $${params.length}`);
  }

  if (filters.createdBefore) {
    params.push(filters.createdBefore);
    whereClauses.push(`created_at <= $${params.length}`);
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const dataQuery = await pool.query(
    `
    SELECT *
    FROM markets
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pageSize, offset]
  );

  const countQuery = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM markets ${where}`,
    params
  );

  return {
    data: dataQuery.rows.map(mapRowToMarket),
    pagination: {
      page,
      pageSize,
      total: Number(countQuery.rows[0]?.count ?? 0)
    }
  };
};
