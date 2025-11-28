export interface WrapRequest {
  userId: string;
  tokenId: string;
  amount: string;
  destinationAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface UnwrapRequest {
  userId: string;
  usdcAmount: string;
  targetTokenId: string;
  destinationAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface WrapTransaction {
  id: string;
  userId: string;
  tokenId: string;
  tokenAmount: string;
  usdcAmount: string;
  exchangeRate: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  sapphireTransactionId: string | null;
  blockchainTxHash: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface UnwrapTransaction {
  id: string;
  userId: string;
  usdcAmount: string;
  tokenId: string;
  tokenAmount: string;
  exchangeRate: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  sapphireTransactionId: string | null;
  blockchainTxHash: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface SapphireWrapResponse {
  transactionId: string;
  status: string;
  usdcAmount: string;
  exchangeRate: string;
  estimatedCompletionTime?: string;
}

export interface SapphireUnwrapResponse {
  transactionId: string;
  status: string;
  tokenAmount: string;
  exchangeRate: string;
  estimatedCompletionTime?: string;
}

export interface WrapQuote {
  tokenId: string;
  tokenAmount: string;
  usdcAmount: string;
  exchangeRate: string;
  fees: {
    platformFee: string;
    networkFee: string;
    totalFee: string;
  };
  expiresAt: Date;
}
