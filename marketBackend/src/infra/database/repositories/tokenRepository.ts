import { getDatabasePool } from '@infra/database';
import { Token, UserBalance, ComplianceRecord, CreateTokenInput } from '@types/token';

export const createToken = async (input: CreateTokenInput): Promise<Token> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO tokens (token_symbol, token_name, token_type, contract_address, blockchain, decimals, total_supply, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.tokenSymbol,
      input.tokenName,
      input.tokenType,
      input.contractAddress || null,
      input.blockchain,
      input.decimals || 18,
      input.totalSupply || null,
      JSON.stringify(input.metadata || {})
    ]
  );

  return mapTokenRow(result.rows[0]);
};

export const findTokenById = async (tokenId: string): Promise<Token | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM tokens WHERE id = $1', [tokenId]);
  return result.rows.length > 0 ? mapTokenRow(result.rows[0]) : null;
};

export const findTokenBySymbol = async (symbol: string): Promise<Token | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM tokens WHERE token_symbol = $1', [symbol]);
  return result.rows.length > 0 ? mapTokenRow(result.rows[0]) : null;
};

export const listActiveTokens = async (): Promise<Token[]> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM tokens WHERE is_active = true ORDER BY created_at DESC');
  return result.rows.map(mapTokenRow);
};

export const getUserBalance = async (userId: string, tokenId: string): Promise<UserBalance | null> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM user_balances WHERE user_id = $1 AND token_id = $2',
    [userId, tokenId]
  );
  return result.rows.length > 0 ? mapBalanceRow(result.rows[0]) : null;
};

export const getUserBalances = async (userId: string): Promise<UserBalance[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM user_balances WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows.map(mapBalanceRow);
};

export const updateBalance = async (
  userId: string,
  tokenId: string,
  availableBalance: string,
  lockedBalance: string
): Promise<UserBalance> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO user_balances (user_id, token_id, available_balance, locked_balance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, token_id)
     DO UPDATE SET
       available_balance = $3,
       locked_balance = $4,
       updated_at = NOW()
     RETURNING *`,
    [userId, tokenId, availableBalance, lockedBalance]
  );
  return mapBalanceRow(result.rows[0]);
};

export const lockBalance = async (
  userId: string,
  tokenId: string,
  amount: string
): Promise<UserBalance> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `UPDATE user_balances
     SET available_balance = available_balance - $3,
         locked_balance = locked_balance + $3,
         updated_at = NOW()
     WHERE user_id = $1 AND token_id = $2
       AND available_balance >= $3
     RETURNING *`,
    [userId, tokenId, amount]
  );

  if (result.rows.length === 0) {
    throw new Error('Insufficient balance to lock');
  }

  return mapBalanceRow(result.rows[0]);
};

export const unlockBalance = async (
  userId: string,
  tokenId: string,
  amount: string
): Promise<UserBalance> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $3,
         locked_balance = locked_balance - $3,
         updated_at = NOW()
     WHERE user_id = $1 AND token_id = $2
       AND locked_balance >= $3
     RETURNING *`,
    [userId, tokenId, amount]
  );

  if (result.rows.length === 0) {
    throw new Error('Insufficient locked balance to unlock');
  }

  return mapBalanceRow(result.rows[0]);
};

export const getComplianceRecord = async (
  userId: string,
  tokenId?: string
): Promise<ComplianceRecord | null> => {
  const pool = getDatabasePool();
  const query = tokenId
    ? 'SELECT * FROM compliance_records WHERE user_id = $1 AND token_id = $2'
    : 'SELECT * FROM compliance_records WHERE user_id = $1 AND token_id IS NULL';
  const params = tokenId ? [userId, tokenId] : [userId];

  const result = await pool.query(query, params);
  return result.rows.length > 0 ? mapComplianceRow(result.rows[0]) : null;
};

export const upsertComplianceRecord = async (
  userId: string,
  tokenId: string | null,
  data: {
    kycStatus: ComplianceRecord['kycStatus'];
    kycLevel?: string;
    accreditationStatus?: ComplianceRecord['accreditationStatus'];
    whitelistStatus?: boolean;
    jurisdiction?: string;
    expiryDate?: Date;
    metadata?: Record<string, unknown>;
  }
): Promise<ComplianceRecord> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO compliance_records (
       user_id, token_id, kyc_status, kyc_level, accreditation_status,
       whitelist_status, jurisdiction, expiry_date, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, token_id)
     DO UPDATE SET
       kyc_status = $3,
       kyc_level = $4,
       accreditation_status = $5,
       whitelist_status = $6,
       jurisdiction = $7,
       expiry_date = $8,
       metadata = $9,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      tokenId,
      data.kycStatus,
      data.kycLevel || null,
      data.accreditationStatus || null,
      data.whitelistStatus ?? false,
      data.jurisdiction || null,
      data.expiryDate || null,
      JSON.stringify(data.metadata || {})
    ]
  );
  return mapComplianceRow(result.rows[0]);
};

const mapTokenRow = (row: any): Token => ({
  id: row.id,
  tokenSymbol: row.token_symbol,
  tokenName: row.token_name,
  tokenType: row.token_type,
  contractAddress: row.contract_address,
  blockchain: row.blockchain,
  decimals: row.decimals,
  totalSupply: row.total_supply,
  metadata: row.metadata,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapBalanceRow = (row: any): UserBalance => ({
  id: row.id,
  userId: row.user_id,
  tokenId: row.token_id,
  availableBalance: row.available_balance,
  lockedBalance: row.locked_balance,
  updatedAt: row.updated_at
});

const mapComplianceRow = (row: any): ComplianceRecord => ({
  id: row.id,
  userId: row.user_id,
  tokenId: row.token_id,
  kycStatus: row.kyc_status,
  kycLevel: row.kyc_level,
  accreditationStatus: row.accreditation_status,
  whitelistStatus: row.whitelist_status,
  jurisdiction: row.jurisdiction,
  expiryDate: row.expiry_date,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
