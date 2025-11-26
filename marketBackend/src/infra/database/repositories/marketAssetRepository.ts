import { randomUUID } from 'crypto';
import { getDatabasePool } from '@infra/database';
import { MarketAsset, AssetType } from '@types/market';

const mapRowToMarketAsset = (row: any): MarketAsset => ({
  id: row.id,
  marketId: row.market_id,
  assetType: row.asset_type,
  valuation: row.valuation ? parseFloat(row.valuation) : undefined,
  currency: row.currency,
  location: row.location,
  description: row.description,
  complianceDocuments: row.compliance_documents || [],
  regulatoryInfo: row.regulatory_info || {},
  attributes: row.attributes || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export interface CreateMarketAssetInput {
  marketId: string;
  assetType: AssetType;
  valuation?: number;
  currency?: string;
  location?: string;
  description?: string;
  complianceDocuments?: string[];
  regulatoryInfo?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export const createMarketAsset = async (
  input: CreateMarketAssetInput
): Promise<MarketAsset> => {
  const pool = getDatabasePool();
  const id = randomUUID();

  const result = await pool.query(
    `
    INSERT INTO market_assets (
      id, market_id, asset_type, valuation, currency, location, description,
      compliance_documents, regulatory_info, attributes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
    RETURNING *
    `,
    [
      id,
      input.marketId,
      input.assetType,
      input.valuation || null,
      input.currency || 'USD',
      input.location || null,
      input.description || null,
      JSON.stringify(input.complianceDocuments || []),
      JSON.stringify(input.regulatoryInfo || {}),
      JSON.stringify(input.attributes || {})
    ]
  );

  return mapRowToMarketAsset(result.rows[0]);
};

export const findMarketAssetByMarketId = async (
  marketId: string
): Promise<MarketAsset | null> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM market_assets WHERE market_id = $1',
    [marketId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapRowToMarketAsset(result.rows[0]);
};

export const updateMarketAsset = async (
  marketId: string,
  updates: Partial<CreateMarketAssetInput>
): Promise<MarketAsset> => {
  const pool = getDatabasePool();

  const updateFields: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (updates.valuation !== undefined) {
    updateFields.push(`valuation = $${paramIndex++}`);
    params.push(updates.valuation);
  }

  if (updates.location !== undefined) {
    updateFields.push(`location = $${paramIndex++}`);
    params.push(updates.location);
  }

  if (updates.description !== undefined) {
    updateFields.push(`description = $${paramIndex++}`);
    params.push(updates.description);
  }

  if (updates.complianceDocuments !== undefined) {
    updateFields.push(`compliance_documents = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.complianceDocuments));
  }

  if (updates.regulatoryInfo !== undefined) {
    updateFields.push(`regulatory_info = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.regulatoryInfo));
  }

  if (updates.attributes !== undefined) {
    updateFields.push(`attributes = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.attributes));
  }

  updateFields.push(`updated_at = NOW()`);
  params.push(marketId);

  const result = await pool.query(
    `
    UPDATE market_assets
    SET ${updateFields.join(', ')}
    WHERE market_id = $${paramIndex}
    RETURNING *
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new Error(`Market asset for market ${marketId} not found`);
  }

  return mapRowToMarketAsset(result.rows[0]);
};

export const listMarketAssetsByType = async (
  assetType: AssetType
): Promise<MarketAsset[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM market_assets WHERE asset_type = $1 ORDER BY created_at DESC',
    [assetType]
  );

  return result.rows.map(mapRowToMarketAsset);
};
