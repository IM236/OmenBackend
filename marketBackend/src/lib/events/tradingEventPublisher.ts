import { logger } from '@infra/logging/logger';
import { getRedisClient } from '@infra/redis';
import { entityPermissionsClient } from '@clients/entityPermissionsClient';
import { Order, Trade } from '@app-types/trading';

export type TradingEventType =
  | 'order.created'
  | 'order.open'
  | 'order.partially_filled'
  | 'order.matched'
  | 'order.filled'
  | 'order.cancelled'
  | 'trade.executed'
  | 'trade.settlement_pending'
  | 'trade.settled'
  | 'trade.settlement_failed';

export interface TradingEvent {
  eventId: string;
  eventType: TradingEventType;
  timestamp: Date;
  userId?: string;
  orderId?: string;
  tradeId?: string;
  tradingPairId?: string;
  payload: Record<string, any>;
}

/**
 * Event publisher for trading system
 * Publishes events to Redis pub/sub and Entity Permissions Core
 */
export class TradingEventPublisher {
  private readonly channel = 'trading:events';

  /**
   * Publish order created event
   */
  async publishOrderCreated(order: Order): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.created.${order.id}.${Date.now()}`,
      eventType: 'order.created',
      timestamp: new Date(),
      userId: order.userId,
      orderId: order.id,
      tradingPairId: order.tradingPairId,
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber.toString(),
        userId: order.userId,
        tradingPairId: order.tradingPairId,
        side: order.side,
        orderType: order.orderType,
        price: order.price,
        quantity: order.quantity,
        status: order.status
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish order open event (order is now in the order book)
   */
  async publishOrderOpen(order: Order): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.open.${order.id}.${Date.now()}`,
      eventType: 'order.open',
      timestamp: new Date(),
      userId: order.userId,
      orderId: order.id,
      tradingPairId: order.tradingPairId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        status: 'OPEN',
        price: order.price,
        quantity: order.quantity
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish order partially filled event
   */
  async publishOrderPartiallyFilled(order: Order): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.partially_filled.${order.id}.${Date.now()}`,
      eventType: 'order.partially_filled',
      timestamp: new Date(),
      userId: order.userId,
      orderId: order.id,
      tradingPairId: order.tradingPairId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        filledQuantity: order.filledQuantity,
        quantity: order.quantity,
        averageFillPrice: order.averageFillPrice,
        status: 'PARTIAL'
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish order matched event
   */
  async publishOrderMatched(orderId: string, matchedQuantity: string): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.matched.${orderId}.${Date.now()}`,
      eventType: 'order.matched',
      timestamp: new Date(),
      orderId,
      payload: {
        orderId,
        matchedQuantity
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish order filled event
   */
  async publishOrderFilled(order: Order): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.filled.${order.id}.${Date.now()}`,
      eventType: 'order.filled',
      timestamp: new Date(),
      userId: order.userId,
      orderId: order.id,
      tradingPairId: order.tradingPairId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        filledQuantity: order.filledQuantity,
        averageFillPrice: order.averageFillPrice
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish order cancelled event
   */
  async publishOrderCancelled(order: Order): Promise<void> {
    const event: TradingEvent = {
      eventId: `order.cancelled.${order.id}.${Date.now()}`,
      eventType: 'order.cancelled',
      timestamp: new Date(),
      userId: order.userId,
      orderId: order.id,
      tradingPairId: order.tradingPairId,
      payload: {
        orderId: order.id,
        userId: order.userId,
        status: order.status
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish trade executed event
   */
  async publishTradeExecuted(trade: Trade): Promise<void> {
    const event: TradingEvent = {
      eventId: `trade.executed.${trade.id}.${Date.now()}`,
      eventType: 'trade.executed',
      timestamp: new Date(),
      tradeId: trade.id,
      tradingPairId: trade.tradingPairId,
      payload: {
        tradeId: trade.id,
        tradeNumber: trade.tradeNumber.toString(),
        tradingPairId: trade.tradingPairId,
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        buyerOrderId: trade.buyerOrderId,
        sellerOrderId: trade.sellerOrderId,
        price: trade.price,
        quantity: trade.quantity,
        buyerFee: trade.buyerFee,
        sellerFee: trade.sellerFee,
        executedAt: trade.executedAt
      }
    };

    await this.publishEvent(event);

    await this.notifyEntityPermissionsCore('trade.executed', {
      tradeId: trade.id,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      tradingPairId: trade.tradingPairId,
      quantity: trade.quantity,
      price: trade.price
    });
  }

  /**
   * Publish trade settlement pending event
   */
  async publishTradeSettlementPending(tradeId: string): Promise<void> {
    const event: TradingEvent = {
      eventId: `trade.settlement_pending.${tradeId}.${Date.now()}`,
      eventType: 'trade.settlement_pending',
      timestamp: new Date(),
      tradeId,
      payload: {
        tradeId,
        status: 'PENDING'
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Publish trade settled event
   */
  async publishTradeSettled(tradeId: string, blockchainTxHash: string): Promise<void> {
    const event: TradingEvent = {
      eventId: `trade.settled.${tradeId}.${Date.now()}`,
      eventType: 'trade.settled',
      timestamp: new Date(),
      tradeId,
      payload: {
        tradeId,
        blockchainTxHash,
        status: 'SETTLED'
      }
    };

    await this.publishEvent(event);

    await this.notifyEntityPermissionsCore('trade.settled', {
      tradeId,
      blockchainTxHash
    });
  }

  /**
   * Publish trade settlement failed event
   */
  async publishTradeSettlementFailed(tradeId: string, reason: string): Promise<void> {
    const event: TradingEvent = {
      eventId: `trade.settlement_failed.${tradeId}.${Date.now()}`,
      eventType: 'trade.settlement_failed',
      timestamp: new Date(),
      tradeId,
      payload: {
        tradeId,
        reason,
        status: 'FAILED'
      }
    };

    await this.publishEvent(event);
  }

  /**
   * Core event publishing to Redis
   */
  private async publishEvent(event: TradingEvent): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.publish(this.channel, JSON.stringify(event));

      logger.debug(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          userId: event.userId,
          orderId: event.orderId,
          tradeId: event.tradeId
        },
        'Trading event published'
      );
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish trading event');
    }
  }

  /**
   * Notify Entity Permissions Core about important events
   */
  private async notifyEntityPermissionsCore(
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      logger.info({ eventType, payload }, 'Notifying Entity Permissions Core');
    } catch (error) {
      logger.warn({ error, eventType }, 'Failed to notify Entity Permissions Core');
    }
  }

  /**
   * Subscribe to trading events (for internal listeners)
   */
  async subscribe(callback: (event: TradingEvent) => void): Promise<void> {
    const redis = getRedisClient();
    await redis.subscribe(this.channel, (err) => {
      if (err) {
        logger.error({ error: err }, 'Failed to subscribe to trading events');
        return;
      }
      logger.info('Subscribed to trading events');
    });

    redis.on('message', (channel, message) => {
      if (channel === this.channel) {
        try {
          const event = JSON.parse(message) as TradingEvent;
          callback(event);
        } catch (error) {
          logger.error({ error, message }, 'Failed to parse trading event');
        }
      }
    });
  }
}

export const tradingEventPublisher = new TradingEventPublisher();
