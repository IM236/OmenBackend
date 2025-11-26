import EventEmitter from 'events';

import { listMarketEvents } from '@infra/database/repositories/marketEventRepository';
import { logger } from '@infra/logging/logger';
import { decryptEventPayload, processMarketEvent } from '@services/eventProcessingService';
import { MarketHistoryEvent } from '@types/market';

const DEFAULT_POLL_INTERVAL_MS = 5_000;

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
      // TODO: Connect to Sapphire RPC/WebSocket and retrieve events.
      const simulatedEvent: MarketHistoryEvent = {
        id: 'placeholder',
        marketId: 'placeholder-market',
        transactionHash: '0x123',
        eventType: 'market.updated',
        eventTimestamp: new Date(),
        payload: {}
      };

      const decryptedEvent = await decryptEventPayload(simulatedEvent);
      await processMarketEvent(decryptedEvent);

      this.emit('event', decryptedEvent);
    } catch (error) {
      logger.error(error, 'Failed to poll market events');
    }
  }

  async getHistory(marketId: string): Promise<MarketHistoryEvent[]> {
    return listMarketEvents(marketId);
  }
}
