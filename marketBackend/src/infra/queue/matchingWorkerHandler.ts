import { Job, Worker } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { createQueueConnection, registerWorker } from './index';
import { getDatabasePool } from '@infra/database';
import { getRedisClient } from '@infra/redis';
import {
  findOrderById,
  updateOrderStatus,
  getOpenOrdersForPair,
  findTradingPairById,
  createTrade,
  insertAuditLog
} from '@infra/database/repositories/tradingRepository';
import { Order, TradingPair, Trade } from '@app-types/trading';
import { tradingEventPublisher } from '@lib/events/tradingEventPublisher';
import { TokenService } from '@services/tokenService';
import {
  getSettlementQueue,
  getNotificationQueue,
  getAnalyticsQueue,
  getMatchingQueue
} from './index';

interface MatchingJobData {
  orderId: string;
  tradingPairId: string;
  triggerOrderId?: string; // Optional: the order that triggered this matching attempt
}

interface MatchResult {
  matched: boolean;
  tradesExecuted: number;
  remainingQuantity: string;
  finalStatus: Order['status'];
}

/**
 * Optimized order matching worker using Redis-backed order book
 * This worker processes order matching jobs asynchronously to prevent blocking the API
 */
export class MatchingWorker {
  private worker: Worker;
  private tokenService: TokenService;
  private readonly ORDERBOOK_PREFIX = 'orderbook:';
  private readonly ORDERBOOK_TTL = 300; // 5 minutes

  constructor(tokenService: TokenService) {
    this.tokenService = tokenService;
    this.worker = new Worker(
      'order-matching',
      async (job: Job<MatchingJobData>) => this.processMatchingJob(job),
      {
        connection: createQueueConnection(),
        concurrency: 10, // Process up to 10 matching jobs concurrently
        limiter: {
          max: 100, // Max 100 jobs
          duration: 1000 // per second
        },
        settings: {
          stalledInterval: 30000, // Check for stalled jobs every 30s
          maxStalledCount: 3
        }
      }
    );

    this.setupEventHandlers();
    registerWorker(this.worker);
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job<MatchingJobData>) => {
      logger.info(
        {
          jobId: job.id,
          orderId: job.data.orderId,
          processingTime: job.processedOn ? Date.now() - job.processedOn : 0
        },
        'Matching job completed'
      );
    });

    this.worker.on('failed', (job: Job<MatchingJobData> | undefined, error: Error) => {
      logger.error(
        {
          jobId: job?.id,
          orderId: job?.data.orderId,
          error: error.message,
          stack: error.stack
        },
        'Matching job failed'
      );
    });

    this.worker.on('stalled', (jobId: string) => {
      logger.warn({ jobId }, 'Matching job stalled');
    });

    this.worker.on('error', (error: Error) => {
      logger.error({ error: error.message }, 'Matching worker error');
    });
  }

  private async processMatchingJob(job: Job<MatchingJobData>): Promise<MatchResult> {
    const { orderId, tradingPairId } = job.data;

    logger.debug(
      { orderId, tradingPairId, jobId: job.id },
      'Processing matching job'
    );

    // Fetch the order
    const order = await findOrderById(orderId);
    if (!order) {
      logger.warn({ orderId }, 'Order not found for matching');
      throw new Error(`Order ${orderId} not found`);
    }

    // Only match orders that are in PENDING_MATCH or OPEN state
    if (order.status !== 'PENDING_MATCH' && order.status !== 'OPEN' && order.status !== 'PARTIAL') {
      logger.debug(
        { orderId, status: order.status },
        'Order not in matchable state, skipping'
      );
      return {
        matched: false,
        tradesExecuted: 0,
        remainingQuantity: order.quantity,
        finalStatus: order.status
      };
    }

    // Fetch the trading pair
    const pair = await findTradingPairById(tradingPairId);
    if (!pair) {
      throw new Error(`Trading pair ${tradingPairId} not found`);
    }

    if (!pair.isActive) {
      logger.warn({ tradingPairId }, 'Trading pair is not active');
      await updateOrderStatus(orderId, 'CANCELLED');
      await tradingEventPublisher.publishOrderCancelled(order);
      return {
        matched: false,
        tradesExecuted: 0,
        remainingQuantity: order.quantity,
        finalStatus: 'CANCELLED'
      };
    }

    // Transition to OPEN status if currently PENDING_MATCH
    if (order.status === 'PENDING_MATCH') {
      await updateOrderStatus(orderId, 'OPEN');
      await tradingEventPublisher.publishOrderOpen(order);
      order.status = 'OPEN';
    }

    // Execute the matching algorithm
    const result = await this.executeMatching(order, pair);

    // Schedule re-matching for opposing orders if this order is now in the book
    if (result.finalStatus === 'OPEN' || result.finalStatus === 'PARTIAL') {
      await this.scheduleOpposingMatches(order, pair);
    }

    return result;
  }

  private async executeMatching(order: Order, pair: TradingPair): Promise<MatchResult> {
    const opposingSide = order.side === 'BUY' ? 'SELL' : 'BUY';

    // Get opposing orders from Redis-backed order book (or fallback to DB)
    const opposingOrders = await this.getOpposingOrders(pair.id, opposingSide);

    let remainingQuantity = BigInt(order.quantity) - BigInt(order.filledQuantity);
    let tradesExecuted = 0;

    for (const opposingOrder of opposingOrders) {
      if (remainingQuantity === BigInt(0)) break;

      // Check if orders can match
      if (!this.canMatch(order, opposingOrder)) continue;

      // Calculate match quantity
      const opposingRemaining = BigInt(opposingOrder.quantity) - BigInt(opposingOrder.filledQuantity);
      const matchQuantity = remainingQuantity < opposingRemaining
        ? remainingQuantity
        : opposingRemaining;

      // Execute the trade
      try {
        await this.executeTrade(order, opposingOrder, matchQuantity.toString(), pair);
        tradesExecuted++;
        remainingQuantity -= matchQuantity;
      } catch (error) {
        logger.error(
          {
            orderId: order.id,
            opposingOrderId: opposingOrder.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          'Failed to execute trade'
        );
        // Continue trying to match with other orders
        continue;
      }
    }

    // Update final order status
    let finalStatus: Order['status'];
    if (remainingQuantity === BigInt(0)) {
      finalStatus = 'FILLED';
      await updateOrderStatus(order.id, 'FILLED');
      await tradingEventPublisher.publishOrderFilled(order);
      await this.removeOrderFromOrderBook(order);
    } else if (remainingQuantity < BigInt(order.quantity)) {
      finalStatus = 'PARTIAL';
      await updateOrderStatus(order.id, 'PARTIAL');
      await tradingEventPublisher.publishOrderPartiallyFilled(order);
      await this.addOrderToOrderBook(order);
    } else {
      finalStatus = 'OPEN';
      await this.addOrderToOrderBook(order);
    }

    return {
      matched: tradesExecuted > 0,
      tradesExecuted,
      remainingQuantity: remainingQuantity.toString(),
      finalStatus
    };
  }

  private async getOpposingOrders(tradingPairId: string, side: Order['side']): Promise<Order[]> {
    // Try to get from Redis-backed order book first
    const redisOrders = await this.getOrdersFromRedisOrderBook(tradingPairId, side);

    if (redisOrders.length > 0) {
      return redisOrders;
    }

    // Fallback to database query
    const dbOrders = await getOpenOrdersForPair(tradingPairId, side, 100);

    // Cache in Redis for future lookups
    if (dbOrders.length > 0) {
      await this.cacheOrdersInRedis(tradingPairId, side, dbOrders);
    }

    return dbOrders;
  }

  private async getOrdersFromRedisOrderBook(
    tradingPairId: string,
    side: Order['side']
  ): Promise<Order[]> {
    const redis = getRedisClient();
    const key = `${this.ORDERBOOK_PREFIX}${tradingPairId}:${side.toLowerCase()}s`;

    try {
      // Get orders sorted by price (best prices first)
      const range = side === 'BUY'
        ? await redis.zrange(key, 0, 99) // Highest prices first (stored as negative)
        : await redis.zrange(key, 0, 99); // Lowest prices first

      return range.map(json => JSON.parse(json) as Order);
    } catch (error) {
      logger.warn(
        { tradingPairId, side, error },
        'Failed to get orders from Redis order book'
      );
      return [];
    }
  }

  private async cacheOrdersInRedis(
    tradingPairId: string,
    side: Order['side'],
    orders: Order[]
  ): Promise<void> {
    const redis = getRedisClient();
    const key = `${this.ORDERBOOK_PREFIX}${tradingPairId}:${side.toLowerCase()}s`;

    try {
      // Clear existing cache
      await redis.del(key);

      // Add orders to sorted set
      if (orders.length > 0) {
        const entries: (string | number)[] = [];
        for (const order of orders) {
          if (!order.price) continue;

          const score = side === 'BUY'
            ? -Number(order.price) // Negative for reverse sort (highest first)
            : Number(order.price); // Normal sort (lowest first)

          entries.push(score, JSON.stringify(order));
        }

        if (entries.length > 0) {
          await redis.zadd(key, ...entries);
          await redis.expire(key, this.ORDERBOOK_TTL);
        }
      }
    } catch (error) {
      logger.warn(
        { tradingPairId, side, error },
        'Failed to cache orders in Redis'
      );
    }
  }

  private canMatch(order: Order, opposingOrder: Order): boolean {
    // Market orders always match
    if (order.orderType === 'MARKET') return true;
    if (!order.price || !opposingOrder.price) return false;

    // For buy orders: willing to pay >= asking price
    // For sell orders: willing to accept <= bid price
    if (order.side === 'BUY') {
      return BigInt(order.price) >= BigInt(opposingOrder.price);
    } else {
      return BigInt(order.price) <= BigInt(opposingOrder.price);
    }
  }

  private async executeTrade(
    order: Order,
    opposingOrder: Order,
    matchQuantity: string,
    pair: TradingPair
  ): Promise<Trade> {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Price taker gets the maker's price
      const tradePrice = opposingOrder.price!;
      const buyerOrder = order.side === 'BUY' ? order : opposingOrder;
      const sellerOrder = order.side === 'SELL' ? order : opposingOrder;

      const buyerFee = this.calculateFee(matchQuantity, tradePrice);
      const sellerFee = this.calculateFee(matchQuantity, tradePrice);

      // Create trade record
      const trade = await createTrade({
        tradingPairId: pair.id,
        buyerOrderId: buyerOrder.id,
        sellerOrderId: sellerOrder.id,
        buyerId: buyerOrder.userId,
        sellerId: sellerOrder.userId,
        price: tradePrice,
        quantity: matchQuantity,
        buyerFee,
        sellerFee
      });

      const quoteAmount = this.calculateQuoteAmount(matchQuantity, tradePrice);

      // Update seller balances (unlock base, add quote)
      await this.tokenService.updateBalanceInternal(
        sellerOrder.userId,
        pair.baseTokenId,
        (await this.getAvailableBalance(sellerOrder.userId, pair.baseTokenId)),
        (BigInt(await this.getLockedBalance(sellerOrder.userId, pair.baseTokenId)) - BigInt(matchQuantity)).toString()
      );

      await this.tokenService.updateBalanceInternal(
        sellerOrder.userId,
        pair.quoteTokenId,
        (BigInt(await this.getAvailableBalance(sellerOrder.userId, pair.quoteTokenId)) + BigInt(quoteAmount) - BigInt(sellerFee)).toString(),
        (await this.getLockedBalance(sellerOrder.userId, pair.quoteTokenId))
      );

      // Update buyer balances (unlock quote, add base)
      await this.tokenService.updateBalanceInternal(
        buyerOrder.userId,
        pair.quoteTokenId,
        (await this.getAvailableBalance(buyerOrder.userId, pair.quoteTokenId)),
        (BigInt(await this.getLockedBalance(buyerOrder.userId, pair.quoteTokenId)) - BigInt(quoteAmount)).toString()
      );

      await this.tokenService.updateBalanceInternal(
        buyerOrder.userId,
        pair.baseTokenId,
        (BigInt(await this.getAvailableBalance(buyerOrder.userId, pair.baseTokenId)) + BigInt(matchQuantity) - BigInt(buyerFee)).toString(),
        (await this.getLockedBalance(buyerOrder.userId, pair.baseTokenId))
      );

      // Update order filled quantities
      const buyerFilledQty = (BigInt(buyerOrder.filledQuantity) + BigInt(matchQuantity)).toString();
      const sellerFilledQty = (BigInt(sellerOrder.filledQuantity) + BigInt(matchQuantity)).toString();

      await updateOrderStatus(
        buyerOrder.id,
        buyerFilledQty === buyerOrder.quantity ? 'FILLED' : 'PARTIAL',
        buyerFilledQty
      );

      await updateOrderStatus(
        sellerOrder.id,
        sellerFilledQty === sellerOrder.quantity ? 'FILLED' : 'PARTIAL',
        sellerFilledQty
      );

      // Create audit logs
      await insertAuditLog({
        userId: buyerOrder.userId,
        action: 'TRADE_EXECUTED',
        resourceType: 'trade',
        resourceId: trade.id,
        tradeId: trade.id,
        details: { side: 'BUY', price: tradePrice, quantity: matchQuantity }
      });

      await insertAuditLog({
        userId: sellerOrder.userId,
        action: 'TRADE_EXECUTED',
        resourceType: 'trade',
        resourceId: trade.id,
        tradeId: trade.id,
        details: { side: 'SELL', price: tradePrice, quantity: matchQuantity }
      });

      await client.query('COMMIT');

      // Invalidate order book cache
      await this.invalidateOrderBookCache(pair.id);

      // If opposing order is now filled, remove it from the book
      if (sellerFilledQty === sellerOrder.quantity || buyerFilledQty === buyerOrder.quantity) {
        const filledOrder = sellerFilledQty === sellerOrder.quantity ? sellerOrder : buyerOrder;
        await this.removeOrderFromOrderBook(filledOrder);
        await tradingEventPublisher.publishOrderFilled(filledOrder);
      }

      // Publish events
      await tradingEventPublisher.publishTradeExecuted(trade);
      await tradingEventPublisher.publishTradeSettlementPending(trade.id);

      // Enqueue settlement, notification, and analytics jobs
      const settlementQueue = getSettlementQueue();
      await settlementQueue.add('execute-blockchain-settlement', {
        tradeId: trade.id,
        tradingPairId: pair.id
      });

      const notificationQueue = getNotificationQueue();
      await notificationQueue.add('send-trade-notification', {
        buyerId: buyerOrder.userId,
        sellerId: sellerOrder.userId,
        tradeId: trade.id
      });

      const analyticsQueue = getAnalyticsQueue();
      await analyticsQueue.add('update-market-stats', {
        tradingPairId: pair.id,
        tradeId: trade.id
      });

      logger.info(
        {
          tradeId: trade.id,
          price: tradePrice,
          quantity: matchQuantity,
          buyerOrderId: buyerOrder.id,
          sellerOrderId: sellerOrder.id
        },
        'Trade executed successfully'
      );

      return trade;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Schedule matching jobs for opposing orders when a new order enters the book
   * This enables continuous matching as market conditions change
   */
  private async scheduleOpposingMatches(order: Order, pair: TradingPair): Promise<void> {
    const opposingSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const opposingOrders = await this.getOpposingOrders(pair.id, opposingSide);

    const matchingQueue = getMatchingQueue();

    // Schedule matching for top N opposing orders that might match
    const matchableOrders = opposingOrders
      .filter(opp => this.canMatch(opp, order))
      .slice(0, 10); // Limit to top 10 to avoid queue flooding

    for (const opposingOrder of matchableOrders) {
      try {
        await matchingQueue.add(
          'match-order',
          {
            orderId: opposingOrder.id,
            tradingPairId: pair.id,
            triggerOrderId: order.id
          },
          {
            jobId: `match-${opposingOrder.id}-trigger-${order.id}`,
            delay: 100 // Small delay to batch matches
          }
        );
      } catch (error) {
        logger.warn(
          { opposingOrderId: opposingOrder.id, error },
          'Failed to schedule opposing match'
        );
      }
    }
  }

  private async addOrderToOrderBook(order: Order): Promise<void> {
    const redis = getRedisClient();
    const key = `${this.ORDERBOOK_PREFIX}${order.tradingPairId}:${order.side.toLowerCase()}s`;

    try {
      const score = order.side === 'BUY'
        ? -Number(order.price || 0)
        : Number(order.price || 0);

      await redis.zadd(key, score, JSON.stringify(order));
      await redis.expire(key, this.ORDERBOOK_TTL);
    } catch (error) {
      logger.warn({ orderId: order.id, error }, 'Failed to add order to Redis order book');
    }
  }

  private async removeOrderFromOrderBook(order: Order): Promise<void> {
    const redis = getRedisClient();
    const key = `${this.ORDERBOOK_PREFIX}${order.tradingPairId}:${order.side.toLowerCase()}s`;

    try {
      await redis.zrem(key, JSON.stringify(order));
    } catch (error) {
      logger.warn({ orderId: order.id, error }, 'Failed to remove order from Redis order book');
    }
  }

  private async invalidateOrderBookCache(tradingPairId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`market:${tradingPairId}:depth`);
  }

  private calculateQuoteAmount(baseQuantity: string, price: string): string {
    return (BigInt(baseQuantity) * BigInt(price) / BigInt(10 ** 18)).toString();
  }

  private calculateFee(quantity: string, price: string): string {
    const feeRate = BigInt(25); // 0.25%
    const feeDivisor = BigInt(10000);
    const tradeValue = BigInt(quantity) * BigInt(price) / BigInt(10 ** 18);
    return (tradeValue * feeRate / feeDivisor).toString();
  }

  private async getAvailableBalance(userId: string, tokenId: string): Promise<string> {
    const balance = await this.tokenService.getUserBalance(userId, tokenId);
    return balance?.availableBalance || '0';
  }

  private async getLockedBalance(userId: string, tokenId: string): Promise<string> {
    const balance = await this.tokenService.getUserBalance(userId, tokenId);
    return balance?.lockedBalance || '0';
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}

export const createMatchingWorker = (tokenService: TokenService): MatchingWorker => {
  return new MatchingWorker(tokenService);
};

let matchingWorkerInstance: MatchingWorker | null = null;

export const initializeMatchingWorker = (): void => {
  if (matchingWorkerInstance) {
    logger.warn('Matching worker already initialized');
    return;
  }

  // Import at runtime to avoid circular dependencies
  const { getTokenService } = require('@services/factory');
  const tokenService = getTokenService();

  matchingWorkerInstance = createMatchingWorker(tokenService);
  logger.info('Matching worker initialized');
};

export const getMatchingWorkerInstance = (): MatchingWorker | null => {
  return matchingWorkerInstance;
};
