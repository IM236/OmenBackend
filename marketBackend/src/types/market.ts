export type MarketStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'activating'
  | 'active'
  | 'paused'
  | 'archived';

export type AssetType =
  | 'real_estate'
  | 'corporate_stock'
  | 'government_bond'
  | 'commodity'
  | 'private_equity'
  | 'art_collectible'
  | 'carbon_credit'
  | 'other';

export interface Market {
  id: string;
  name: string;
  ownerId: string;
  issuerId?: string;
  assetType: AssetType;
  status: MarketStatus;
  contractAddress?: string;
  deploymentTxHash?: string;
  tokenSymbol?: string;
  tokenName?: string;
  totalSupply?: number;
  approvedBy?: string;
  approvedAt?: Date;
  activatedAt?: Date;
  rejectedReason?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface MarketAsset {
  id: string;
  marketId: string;
  assetType: AssetType;
  valuation?: number;
  currency: string;
  location?: string;
  description?: string;
  complianceDocuments: string[];
  regulatoryInfo: Record<string, unknown>;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketHistoryEvent {
  id: string;
  marketId: string;
  transactionHash: string;
  eventType: string;
  eventTimestamp: Date;
  payload: Record<string, unknown>;
}

export type MarketApprovalEventType =
  | 'market.registered'
  | 'market.approval_requested'
  | 'market.approved'
  | 'market.rejected'
  | 'market.activation_started'
  | 'market.activated'
  | 'market.paused'
  | 'market.archived';

export interface MarketApprovalEvent {
  id: string;
  marketId: string;
  eventType: MarketApprovalEventType;
  actorId: string;
  actorType: string;
  decision?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface MarketFilters {
  status?: MarketStatus;
  ownerId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  page?: number;
  pageSize?: number;
}

export interface MarketListResponse {
  data: Market[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}
