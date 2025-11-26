export type TransactionStatus =
  | 'pending'
  | 'in_progress'
  | 'confirmed'
  | 'failed'
  | 'dropped';

export interface TransactionRecord {
  id: string;
  marketId: string;
  jobId: string;
  status: TransactionStatus;
  txHash?: string;
  errorReason?: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionJobPayload {
  marketId: string;
  action: 'register' | 'approve' | 'reject' | 'pause' | 'activate';
  calldata: Uint8Array | string;
  metadata: Record<string, unknown>;
}
