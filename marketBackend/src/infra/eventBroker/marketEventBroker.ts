import EventEmitter from 'events';
import { logger } from '@infra/logging/logger';
import { MarketApprovalEvent, MarketApprovalEventType } from '@types/market';
import {
  createMarketApprovalEvent,
  listMarketApprovalEvents
} from '@infra/database/repositories/marketApprovalEventRepository';

/**
 * Market Event Broker
 *
 * Manages the lifecycle events for market registration and approval flow.
 * Events are persisted to database and emitted for external integrations.
 *
 * Event Flow:
 * 1. market.registered - Issuer registers a new RWA market
 * 2. market.approval_requested - Submitted for approval to Entity Permissions
 * 3. market.approved - Approved by admin/compliance
 * 4. market.activation_started - Token deployment initiated
 * 5. market.activated - Token deployed, market live
 *
 * Alternative paths:
 * - market.rejected - Approval denied
 * - market.paused - Temporarily suspended
 * - market.archived - Permanently closed
 */
export class MarketEventBroker extends EventEmitter {
  private static instance: MarketEventBroker;

  private constructor() {
    super();
    this.setupEventHandlers();
  }

  static getInstance(): MarketEventBroker {
    if (!MarketEventBroker.instance) {
      MarketEventBroker.instance = new MarketEventBroker();
    }
    return MarketEventBroker.instance;
  }

  /**
   * Publish a market lifecycle event
   */
  async publishEvent(params: {
    marketId: string;
    eventType: MarketApprovalEventType;
    actorId: string;
    actorType?: string;
    decision?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MarketApprovalEvent> {
    try {
      const event = await createMarketApprovalEvent({
        marketId: params.marketId,
        eventType: params.eventType,
        actorId: params.actorId,
        actorType: params.actorType || 'admin',
        decision: params.decision,
        reason: params.reason,
        metadata: params.metadata || {}
      });

      logger.info(
        {
          marketId: params.marketId,
          eventType: params.eventType,
          actorId: params.actorId
        },
        'Market event published'
      );

      // Emit event for listeners
      this.emit(params.eventType, event);
      this.emit('*', event);

      return event;
    } catch (error) {
      logger.error(
        {
          error,
          marketId: params.marketId,
          eventType: params.eventType
        },
        'Failed to publish market event'
      );
      throw error;
    }
  }

  /**
   * Get event history for a market
   */
  async getMarketEventHistory(marketId: string): Promise<MarketApprovalEvent[]> {
    return listMarketApprovalEvents(marketId);
  }

  /**
   * Check if market has reached a specific state
   */
  async hasReachedState(
    marketId: string,
    eventType: MarketApprovalEventType
  ): Promise<boolean> {
    const events = await this.getMarketEventHistory(marketId);
    return events.some((e) => e.eventType === eventType);
  }

  /**
   * Get the latest event for a market
   */
  async getLatestEvent(marketId: string): Promise<MarketApprovalEvent | null> {
    const events = await this.getMarketEventHistory(marketId);
    return events.length > 0 ? events[0] : null;
  }

  private setupEventHandlers(): void {
    // Log all events for debugging
    this.on('*', (event: MarketApprovalEvent) => {
      logger.debug(
        {
          marketId: event.marketId,
          eventType: event.eventType,
          actorId: event.actorId
        },
        'Market event emitted'
      );
    });

    // Handle market registration
    this.on('market.registered', async (event: MarketApprovalEvent) => {
      logger.info({ marketId: event.marketId }, 'Market registered, awaiting approval');
    });

    // Handle market approval
    this.on('market.approved', async (event: MarketApprovalEvent) => {
      logger.info(
        { marketId: event.marketId, approvedBy: event.actorId },
        'Market approved, ready for activation'
      );
    });

    // Handle market rejection
    this.on('market.rejected', async (event: MarketApprovalEvent) => {
      logger.warn(
        { marketId: event.marketId, reason: event.reason },
        'Market registration rejected'
      );
    });

    // Handle market activation
    this.on('market.activated', async (event: MarketApprovalEvent) => {
      logger.info({ marketId: event.marketId }, 'Market activated and live');
    });
  }

  /**
   * Integration point for Entity Permissions Core
   *
   * This method would be called by webhooks or polling from Entity_Permissions_Core
   * when approval decisions are made.
   */
  async handleEntityPermissionDecision(params: {
    marketId: string;
    entityId: string;
    decision: 'approved' | 'rejected';
    actorId: string;
    reason?: string;
  }): Promise<void> {
    const eventType: MarketApprovalEventType =
      params.decision === 'approved' ? 'market.approved' : 'market.rejected';

    await this.publishEvent({
      marketId: params.marketId,
      eventType,
      actorId: params.actorId,
      actorType: 'admin',
      decision: params.decision,
      reason: params.reason,
      metadata: {
        entityId: params.entityId,
        source: 'entity_permissions_core'
      }
    });
  }
}

export const marketEventBroker = MarketEventBroker.getInstance();
