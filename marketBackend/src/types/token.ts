export type TokenType = 'RWA' | 'CRYPTO' | 'STABLE';

export interface Token {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  tokenType: TokenType;
  contractAddress: string | null;
  blockchain: string;
  decimals: number;
  totalSupply: string | null;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserBalance {
  id: string;
  userId: string;
  tokenId: string;
  availableBalance: string;
  lockedBalance: string;
  updatedAt: Date;
}

export interface ComplianceRecord {
  id: string;
  userId: string;
  tokenId: string | null;
  kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  kycLevel: string | null;
  accreditationStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | null;
  whitelistStatus: boolean;
  jurisdiction: string | null;
  expiryDate: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlockchainEvent {
  id: string;
  eventType: string;
  blockchain: string;
  blockNumber: bigint;
  transactionHash: string;
  tokenId: string | null;
  parsedData: Record<string, unknown>;
  processed: boolean;
  occurredAt: Date;
  createdAt: Date;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  tokenId: string;
  amount: string;
  destinationAddress: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  blockchainTxHash: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface MintTokenInput {
  tokenId: string;
  userId: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface TransferTokenInput {
  tokenId: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface CreateTokenInput {
  tokenSymbol: string;
  tokenName: string;
  tokenType: TokenType;
  contractAddress?: string;
  blockchain: string;
  decimals?: number;
  totalSupply?: string;
  metadata?: Record<string, unknown>;
}
