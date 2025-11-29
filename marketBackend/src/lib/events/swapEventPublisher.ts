import { logger } from '@infra/logging/logger';
import { getRedisClient } from '@infra/redis';

export type SwapEventType =
  | 'swap.requested'
  | 'swap.queued'
  | 'swap.processing'
  | 'swap.completed'
  | 'swap.failed';

export interface SwapEvent {
  eventId: string;
  swapId: string;
  userId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceChain: string;
  targetChain: string;
  status: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  eventType: SwapEventType;
}

export class SwapEventPublisher {
  private readonly channel = 'swap:events';

  async publishRequested(payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }): Promise<void> {
    await this.publishEvent('swap.requested', payload);
  }

  async publishQueued(payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }): Promise<void> {
    await this.publishEvent('swap.queued', payload);
  }

  async publishProcessing(payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }): Promise<void> {
    await this.publishEvent('swap.processing', payload);
  }

  async publishCompleted(payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }): Promise<void> {
    await this.publishEvent('swap.completed', payload);
  }

  async publishFailed(payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }): Promise<void> {
    await this.publishEvent('swap.failed', payload);
  }

  private async publishEvent(
    eventType: SwapEventType,
    payload: Omit<SwapEvent, 'eventType' | 'eventId' | 'timestamp' | 'status'> & { status: string }
  ): Promise<void> {
    const event: SwapEvent = {
      eventId: `${eventType}.${payload.swapId}.${Date.now()}`,
      eventType,
      swapId: payload.swapId,
      userId: payload.userId,
      sourceTokenId: payload.sourceTokenId,
      targetTokenId: payload.targetTokenId,
      sourceChain: payload.sourceChain,
      targetChain: payload.targetChain,
      status: payload.status,
      payload: payload.payload,
      timestamp: new Date()
    };

    try {
      const redis = getRedisClient();
      await redis.publish(this.channel, JSON.stringify(event));
      logger.debug(
        {
          swapId: event.swapId,
          eventType,
          userId: event.userId,
          sourceTokenId: event.sourceTokenId,
          targetTokenId: event.targetTokenId
        },
        'Swap event published'
      );
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish swap event');
    }
  }
}

export const swapEventPublisher = new SwapEventPublisher();
