import { entityPermissionsClient } from '@clients/entityPermissionsClient';
import { marketEventBroker } from '@infra/eventBroker/marketEventBroker';
import {
  createMarket,
  findMarketById,
  listMarkets,
  approveMarket,
  rejectMarket,
  activateMarket,
  updateMarketStatus
} from '@infra/database/repositories/marketRepository';
import { getTokenDeploymentQueue } from '@infra/queue';
import {
  createMarketAsset,
  findMarketAssetByMarketId
} from '@infra/database/repositories/marketAssetRepository';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import {
  Market,
  MarketFilters,
  MarketListResponse,
  MarketAsset,
  AssetType
} from '@app-types/market';
import { AdminContext } from '@app-types/auth';

export interface RegisterMarketInput {
  name: string;
  issuerId: string;
  assetType: AssetType;
  tokenSymbol: string;
  tokenName: string;
  totalSupply: number;
  entityId: string;
  assetDetails: {
    valuation?: number;
    currency?: string;
    location?: string;
    description?: string;
    complianceDocuments?: string[];
    regulatoryInfo?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionInput {
  marketId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  entityId: string;
}

/**
 * Market Service - RWA Issuance & Lifecycle Management
 *
 * Flow:
 * 1. Issuer registers market (RWA) → status: 'draft' → 'pending_approval'
 * 2. Admin approves/rejects via Entity Permissions → status: 'approved' or 'rejected'
 * 3. On approval, market activates → Deploy token to Sapphire → status: 'active'
 * 4. Market is live for trading
 */
export class MarketService {
  /**
   * Step 1: Issuer registers a new RWA market
   *
   * Creates market record and asset details, then requests approval
   * from Entity Permissions Core.
   */
  async registerMarket(
    input: RegisterMarketInput,
    admin: AdminContext
  ): Promise<{ market: Market; asset: MarketAsset }> {
    // Check authorization for market registration
    await this.assertAuthorization(admin, input.entityId, 'market.register');

    logger.info(
      {
        issuerId: input.issuerId,
        assetType: input.assetType,
        tokenSymbol: input.tokenSymbol
      },
      'Registering new RWA market'
    );

    // Create market record in draft status
    const market = await createMarket({
      name: input.name,
      ownerId: admin.id,
      issuerId: input.issuerId,
      assetType: input.assetType,
      tokenSymbol: input.tokenSymbol,
      tokenName: input.tokenName,
      totalSupply: input.totalSupply,
      metadata: input.metadata || {}
    });

    // Create associated asset details
    const asset = await createMarketAsset({
      marketId: market.id,
      assetType: input.assetType,
      valuation: input.assetDetails.valuation,
      currency: input.assetDetails.currency || 'USD',
      location: input.assetDetails.location,
      description: input.assetDetails.description,
      complianceDocuments: input.assetDetails.complianceDocuments || [],
      regulatoryInfo: input.assetDetails.regulatoryInfo || {},
      attributes: input.assetDetails.attributes || {}
    });

    // Publish registration event
    await marketEventBroker.publishEvent({
      marketId: market.id,
      eventType: 'market.registered',
      actorId: admin.id,
      actorType: 'issuer',
      metadata: {
        entityId: input.entityId,
        assetType: input.assetType
      }
    });

    // Request approval (non-blocking - just updates status and publishes event)
    await this.requestApproval(market.id, input.entityId, admin);

    // Return immediately - approval will happen asynchronously
    return { market, asset };
  }

  /**
   * Step 2: Request approval from Entity Permissions Core
   *
   * This integrates with the external permissions service to
   * check if the issuer and market can proceed.
   */
  private async requestApproval(
    marketId: string,
    entityId: string,
    admin: AdminContext
  ): Promise<void> {
    const market = await findMarketById(marketId);
    if (!market) {
      throw new ApplicationError('Market not found', {
        statusCode: 404,
        code: 'market_not_found'
      });
    }

    // Update status to pending approval
    await updateMarketStatus(marketId, 'pending_approval', {
      approvalRequestedAt: new Date().toISOString(),
      approvalRequestedBy: admin.id
    });

    // Publish approval request event
    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.approval_requested',
      actorId: admin.id,
      actorType: 'issuer',
      metadata: { entityId }
    });

    logger.info({ marketId, entityId }, 'Market approval requested');
  }

  /**
   * Step 3: Handle approval decision from Entity Permissions
   *
   * Called after admin reviews and approves/rejects the market
   * through Entity Permissions Core integration.
   */
  async processApprovalDecision(
    input: ApprovalDecisionInput,
    admin: AdminContext
  ): Promise<Market> {
    const market = await findMarketById(input.marketId);
    if (!market) {
      throw new ApplicationError('Market not found', {
        statusCode: 404,
        code: 'market_not_found'
      });
    }

    if (market.status !== 'pending_approval') {
      throw new ApplicationError('Market is not pending approval', {
        statusCode: 400,
        code: 'invalid_market_status',
        details: { currentStatus: market.status }
      });
    }

    // Check authorization for approval action
    await this.assertAuthorization(
      admin,
      input.entityId,
      `market.${input.decision}`
    );

    let updatedMarket: Market;

    if (input.decision === 'approve') {
      updatedMarket = await approveMarket(input.marketId, admin.id);

      // Publish approval event
      await marketEventBroker.publishEvent({
        marketId: input.marketId,
        eventType: 'market.approved',
        actorId: admin.id,
        actorType: 'admin',
        decision: 'approved',
        metadata: { entityId: input.entityId }
      });

      logger.info(
        { marketId: input.marketId, approvedBy: admin.id },
        'Market approved, initiating activation'
      );

      // Automatically trigger activation
      await this.activateMarket(input.marketId, admin);
    } else {
      updatedMarket = await rejectMarket(
        input.marketId,
        input.reason || 'No reason provided'
      );

      // Publish rejection event
      await marketEventBroker.publishEvent({
        marketId: input.marketId,
        eventType: 'market.rejected',
        actorId: admin.id,
        actorType: 'admin',
        decision: 'rejected',
        reason: input.reason,
        metadata: { entityId: input.entityId }
      });

      logger.warn(
        { marketId: input.marketId, reason: input.reason },
        'Market registration rejected'
      );
    }

    return updatedMarket;
  }

  /**
   * Step 4: Activate market and deploy token to Sapphire
   *
   * This step:
   * 1. Updates market status to 'activating'
   * 2. Enqueues token deployment job to BullMQ
   * 3. Returns immediately (deployment happens asynchronously)
   * 4. Worker will update market with contract address and set status to 'active'
   */
  async activateMarket(marketId: string, admin: AdminContext): Promise<Market> {
    const market = await findMarketById(marketId);
    if (!market) {
      throw new ApplicationError('Market not found', {
        statusCode: 404,
        code: 'market_not_found'
      });
    }

    if (market.status !== 'approved') {
      throw new ApplicationError('Market must be approved before activation', {
        statusCode: 400,
        code: 'market_not_approved'
      });
    }

    // Update to activating status
    const activatingMarket = await updateMarketStatus(marketId, 'activating');

    // Publish activation started event
    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.activation_started',
      actorId: admin.id,
      actorType: 'system',
      metadata: {
        tokenSymbol: market.tokenSymbol,
        tokenName: market.tokenName
      }
    });

    logger.info({ marketId }, 'Enqueuing token deployment job');

    // Enqueue deployment job to BullMQ
    const deploymentQueue = getTokenDeploymentQueue();
    await deploymentQueue.add(
      'deploy-market-token',
      {
        marketId,
        tokenName: market.tokenName || market.name,
        tokenSymbol: market.tokenSymbol || 'RWA',
        decimals: 18,
        totalSupply: (market.totalSupply || 0).toString(),
        actorId: admin.id
      },
      {
        jobId: `deploy-${marketId}`,
        removeOnComplete: false,
        removeOnFail: false
      }
    );

    logger.info({ marketId }, 'Token deployment job enqueued successfully');

    return activatingMarket;
  }

  /**
   * Pause an active market
   */
  async pauseMarket(
    marketId: string,
    entityId: string,
    admin: AdminContext
  ): Promise<Market> {
    await this.assertAuthorization(admin, entityId, 'market.pause');

    const market = await updateMarketStatus(marketId, 'paused');

    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.paused',
      actorId: admin.id,
      actorType: 'admin',
      metadata: { entityId }
    });

    return market;
  }

  /**
   * Archive a market
   */
  async archiveMarket(
    marketId: string,
    entityId: string,
    admin: AdminContext
  ): Promise<Market> {
    await this.assertAuthorization(admin, entityId, 'market.archive');

    const market = await updateMarketStatus(marketId, 'archived');

    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.archived',
      actorId: admin.id,
      actorType: 'admin',
      metadata: { entityId }
    });

    return market;
  }

  /**
   * List markets with filters
   */
  async list(filters: MarketFilters): Promise<MarketListResponse> {
    return listMarkets(filters);
  }

  /**
   * Get market by ID
   */
  async getById(marketId: string): Promise<Market | null> {
    return findMarketById(marketId);
  }

  /**
   * Get market with asset details
   */
  async getMarketWithAsset(
    marketId: string
  ): Promise<{ market: Market; asset: MarketAsset | null } | null> {
    const market = await findMarketById(marketId);
    if (!market) {
      return null;
    }

    const asset = await findMarketAssetByMarketId(marketId);
    return { market, asset };
  }

  /**
   * Get market event history
   */
  async getEventHistory(marketId: string) {
    return marketEventBroker.getMarketEventHistory(marketId);
  }

  /**
   * Check authorization with Entity Permissions Core
   */
  private async assertAuthorization(
    admin: AdminContext,
    entityId: string,
    action: string
  ): Promise<void> {
    const response = await entityPermissionsClient.authorize({
      principalId: admin.id,
      principalType: 'admin',
      entityId,
      action,
      context: { roles: admin.roles }
    });

    if (!response.allowed) {
      throw new ApplicationError('Admin is not authorized for this action', {
        statusCode: 403,
        code: 'forbidden',
        details: { reasons: response.reasons }
      });
    }
  }
}
