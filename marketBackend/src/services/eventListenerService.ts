import EventEmitter from 'events';
import { fetch } from 'undici';

import { listMarketEvents } from '@infra/database/repositories/marketEventRepository';
import { logger } from '@infra/logging/logger';
import { decryptEventPayload, processMarketEvent } from '@services/eventProcessingService';
import { MarketHistoryEvent } from '@app-types/market';
import { AppConfig } from '@config';
import {
  isEventProcessed,
  recordProcessedEvent
} from '@infra/database/repositories/processedEventRepository';
import { marketEventBroker } from '@infra/eventBroker/marketEventBroker';

const DEFAULT_POLL_INTERVAL_MS = 10_000; // Poll every 10 seconds

export class MarketEventListener extends EventEmitter {
  private pollingHandle: NodeJS.Timeout | null = null;

  constructor(private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    super();
  }

  async start(): Promise<void> {
    if (this.pollingHandle) {
      return;
    }

    logger.info('Starting market event polling');
    this.pollingHandle = setInterval(async () => {
      await this.pollEvents();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.pollingHandle) {
      clearInterval(this.pollingHandle);
      this.pollingHandle = null;
    }
  }

  private async pollEvents(): Promise<void> {
    try {
      // Poll Entity Permissions Core for approval events
      await this.pollEntityPermissionsEvents();

      // TODO: Poll Sapphire RPC/WebSocket for blockchain events
      // await this.pollSapphireEvents();
    } catch (error) {
      logger.error(error, 'Failed to poll market events');
    }
  }

  /**
   * Poll Entity Permissions Core for market approval events
   *
   * This is a fallback polling mechanism. In production, prefer using
   * webhooks (see webhookController.ts) for real-time event delivery.
   */
  private async pollEntityPermissionsEvents(): Promise<void> {
    if (!AppConfig.permissionsService?.baseUrl) {
      logger.debug('Entity Permissions polling disabled (no baseUrl configured)');
      return;
    }

    try {
      // Poll for approval/rejection events
      const url = `${AppConfig.permissionsService.baseUrl}/api/v1/events?event_type=market.approved,market.rejected&source=entity_permissions_core&limit=10`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(AppConfig.permissionsService.apiKey && {
            'x-api-key': AppConfig.permissionsService.apiKey
          })
        },
        signal: AbortSignal.timeout(AppConfig.permissionsService.timeoutMs || 5000)
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, statusText: response.statusText },
          'Failed to poll Entity Permissions Core'
        );
        return;
      }

      const events = (await response.json()) as any[];

      if (!Array.isArray(events) || events.length === 0) {
        return;
      }

      logger.debug({ count: events.length }, 'Polled events from Entity Permissions Core');

      // Process each event
      for (const event of events) {
        await this.processEntityPermissionEvent(event);
      }
    } catch (error) {
      logger.error({ error }, 'Error polling Entity Permissions Core');
    }
  }

  /**
   * Process a single event from Entity Permissions Core
   */
  private async processEntityPermissionEvent(event: any): Promise<void> {
    // Check if already processed
    const alreadyProcessed = await isEventProcessed(event.event_id);
    if (alreadyProcessed) {
      logger.debug({ eventId: event.event_id }, 'Event already processed, skipping');
      return;
    }

    try {
      logger.info(
        { eventId: event.event_id, eventType: event.event_type },
        'Processing polled event'
      );

      // Handle approval/rejection events
      if (event.event_type === 'market.approved' || event.event_type === 'market.rejected') {
        const decision = event.event_type === 'market.approved' ? 'approved' : 'rejected';

        await marketEventBroker.handleEntityPermissionDecision({
          marketId: event.payload.market_id,
          entityId: event.payload.entity_id,
          decision,
          actorId: event.context?.actor_id || 'system',
          reason: event.payload.reason
        });

        // Record successful processing
        await recordProcessedEvent({
          eventId: event.event_id,
          eventType: event.event_type,
          source: event.source || 'entity_permissions_core',
          payload: event.payload || {},
          context: event.context || {},
          processingStatus: 'success'
        });

        // Emit event for listeners
        this.emit('approval_event', event);
      }
    } catch (error) {
      logger.error({ error, eventId: event.event_id }, 'Failed to process polled event');

      // Record failed processing
      await recordProcessedEvent({
        eventId: event.event_id,
        eventType: event.event_type,
        source: event.source || 'entity_permissions_core',
        payload: event.payload || {},
        context: event.context || {},
        processingStatus: 'failed',
        processingError: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async getHistory(marketId: string): Promise<MarketHistoryEvent[]> {
    return listMarketEvents(marketId);
  }
}
