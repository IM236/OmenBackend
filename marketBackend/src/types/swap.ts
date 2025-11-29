export type SwapStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface SwapQuote {
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount: string;
  expectedTargetAmount: string;
  rate: string;
  expiresAt: Date;
  fees: {
    platformFee: string;
    bridgeFee: string;
    networkFee: string;
    totalFee: string;
  };
}

export interface CreateSwapInput {
  userId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceChain: string;
  targetChain: string;
  sourceAmount: string;
  minTargetAmount?: string;
  destinationAddress: string;
  bridgeContractAddress: string;
  metadata?: Record<string, unknown>;
  quote?: SwapQuote;
}

export interface SwapRecord {
  id: string;
  userId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceChain: string;
  targetChain: string;
  sourceAmount: string;
  expectedTargetAmount: string;
  destinationAddress: string;
  bridgeContractAddress: string;
  status: SwapStatus;
  sapphireSwapId: string | null;
  sourceTxHash: string | null;
  targetTxHash: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface SwapJobPayload {
  swapId: string;
  userId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceChain: string;
  targetChain: string;
  sourceAmount: string;
  minTargetAmount?: string;
  destinationAddress: string;
  bridgeContractAddress: string;
  metadata: Record<string, unknown>;
}
