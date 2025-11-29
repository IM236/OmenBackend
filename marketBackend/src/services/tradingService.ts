import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { getRedisClient } from '@infra/redis';
import {
  Order,
  Trade,
  TradingPair,
  CreateOrderInput,
  OrderBook,
  OrderBookEntry,
  MarketStats
} from '@app-types/trading';
import {
  createOrder,
  updateOrderStatus,
  findOrderById,
  getUserOrders,
  getOpenOrdersForPair,
  createTrade,
  findTradingPairById,
  insertAuditLog,
  upsertMarketStats,
  getMarketStats
} from '@infra/database/repositories/tradingRepository';
import { findMarketById } from '@infra/database/repositories/marketRepository';
import { findTokenById } from '@infra/database/repositories/tokenRepository';
import { TokenService } from './tokenService';
import { Queue } from 'bullmq';
import { getDatabasePool } from '@infra/database';
import { EIP712Verifier, OrderSignatureData } from '@lib/signature/eip712';
import { nonceService } from '@lib/signature/nonceService';
import { tradingEventPublisher } from '@lib/events/tradingEventPublisher';

export class TradingService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly settlementQueue: Queue,
    private readonly notificationQueue: Queue,
    private readonly analyticsQueue: Queue,
    private readonly matchingQueue: Queue,
    private readonly eip712Verifier: EIP712Verifier
  ) {}

  async submitOrder(input: CreateOrderInput): Promise<Order> {
    this.eip712Verifier.validateExpiry(input.expiry);

    await nonceService.validateAndConsumeNonce(input.userAddress, input.nonce);

    const signatureData: OrderSignatureData = {
      marketId: input.tradingPairId,
      side: input.side,
      orderKind: input.orderType,
      quantity: input.quantity,
      price: input.price || null,
      nonce: input.nonce,
      expiry: input.expiry
    };

    const isValid = await this.eip712Verifier.verifyOrderSignature(
      signatureData,
      input.signature,
      input.userAddress
    );

    if (!isValid) {
      throw new ApplicationError('Invalid signature', {
        statusCode: 401,
        code: 'invalid_signature'
      });
    }

    const pair = await findTradingPairById(input.tradingPairId);
    if (!pair) {
      throw new ApplicationError('Trading pair not found', {
        statusCode: 404,
        code: 'pair_not_found'
      });
    }

    if (!pair.isActive) {
      throw new ApplicationError('Trading pair is not active', {
        statusCode: 400,
        code: 'pair_inactive'
      });
    }

    // Check if this is an RWA market and apply compliance
    if (pair.marketId) {
      await this.validateRwaCompliance(pair.marketId, input.userId, pair);
    }

    await this.validateOrderSize(pair, input.quantity);

    const priceRequiredOrderTypes: Order['orderType'][] = ['LIMIT', 'STOP_LIMIT'];
    if (priceRequiredOrderTypes.includes(input.orderType) && !input.price) {
      throw new ApplicationError('Price is required for limit and stop-limit orders', {
        statusCode: 400,
        code: 'price_required'
      });
    }

    const tokenToLock = input.side === 'BUY' ? pair.quoteTokenId : pair.baseTokenId;
    const amountToLock = input.side === 'BUY'
      ? this.calculateQuoteAmount(input.quantity, input.price!)
      : input.quantity;

    await this.tokenService.lockBalanceForOrder(input.userId, tokenToLock, amountToLock);

    // Create order with PENDING_MATCH status
    const orderInput = {
      ...input,
      status: 'PENDING_MATCH' as const
    };
    const order = await createOrder(orderInput);

    await insertAuditLog({
      userId: input.userId,
      action: 'ORDER_CREATED',
      resourceType: 'order',
      resourceId: order.id,
      orderId: order.id,
      details: { side: input.side, orderType: input.orderType, quantity: input.quantity }
    });

    await this.cacheUserOrder(order);

    await tradingEventPublisher.publishOrderCreated(order);

    // Enqueue matching job instead of blocking
    await this.matchingQueue.add(
      'match-order',
      {
        orderId: order.id,
        tradingPairId: pair.id
      },
      {
        jobId: `match-${order.id}`,
        priority: input.orderType === 'MARKET' ? 1 : 5, // Market orders get higher priority
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );

    logger.info(
      { orderId: order.id, userId: input.userId, pair: pair.pairSymbol },
      'Order submitted and queued for matching'
    );

    return order;
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = await findOrderById(orderId);
    if (!order) {
      throw new ApplicationError('Order not found', {
        statusCode: 404,
        code: 'order_not_found'
      });
    }

    if (order.userId !== userId) {
      throw new ApplicationError('Unauthorized', {
        statusCode: 403,
        code: 'unauthorized'
      });
    }

    if (order.status !== 'OPEN' && order.status !== 'PARTIAL') {
      throw new ApplicationError('Order cannot be cancelled', {
        statusCode: 400,
        code: 'invalid_status'
      });
    }

    const pair = await findTradingPairById(order.tradingPairId);
    if (!pair) {
      throw new ApplicationError('Trading pair not found', {
        statusCode: 404,
        code: 'pair_not_found'
      });
    }

    const unfilledQuantity = (BigInt(order.quantity) - BigInt(order.filledQuantity)).toString();
    const tokenToUnlock = order.side === 'BUY' ? pair.quoteTokenId : pair.baseTokenId;
    const amountToUnlock = order.side === 'BUY'
      ? this.calculateQuoteAmount(unfilledQuantity, order.price!)
      : unfilledQuantity;

    await this.tokenService.unlockBalanceFromOrder(order.userId, tokenToUnlock, amountToUnlock);

    const updatedOrder = await updateOrderStatus(orderId, 'CANCELLED');

    await this.removeOrderFromOrderBook(updatedOrder);

    await insertAuditLog({
      userId,
      action: 'ORDER_CANCELLED',
      resourceType: 'order',
      resourceId: orderId,
      orderId,
      details: {}
    });

    await tradingEventPublisher.publishOrderCancelled(updatedOrder);

    logger.info({ orderId, userId }, 'Order cancelled');

    return updatedOrder;
  }

  async getUserOrders(userId: string, status?: Order['status']): Promise<Order[]> {
    return getUserOrders(userId, status);
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    return findOrderById(orderId);
  }

  async getOrderBook(tradingPairId: string): Promise<OrderBook> {
    const cached = await this.getCachedOrderBook(tradingPairId);
    if (cached) {
      return cached;
    }

    const [bids, asks] = await Promise.all([
      getOpenOrdersForPair(tradingPairId, 'BUY', 50),
      getOpenOrdersForPair(tradingPairId, 'SELL', 50)
    ]);

    const orderBook: OrderBook = {
      tradingPairId,
      bids: this.aggregateOrderBook(bids),
      asks: this.aggregateOrderBook(asks),
      lastUpdate: new Date()
    };

    await this.cacheOrderBook(orderBook);

    return orderBook;
  }

  async getMarketStats(tradingPairId: string): Promise<MarketStats | null> {
    const cached = await this.getCachedMarketStats(tradingPairId);
    if (cached) {
      return cached;
    }

    const stats = await getMarketStats(tradingPairId);
    if (stats) {
      await this.cacheMarketStats(stats);
    }
    return stats;
  }

  private async tryMatchOrder(order: Order, pair: TradingPair): Promise<void> {
    const opposingSide = order.side === 'BUY' ? 'SELL' : 'BUY';
    const opposingOrders = await getOpenOrdersForPair(order.tradingPairId, opposingSide, 50);

    let remainingQuantity = BigInt(order.quantity) - BigInt(order.filledQuantity);

    for (const opposingOrder of opposingOrders) {
      if (remainingQuantity === BigInt(0)) break;

      if (!this.canMatch(order, opposingOrder)) continue;

      const matchQuantity = remainingQuantity < (BigInt(opposingOrder.quantity) - BigInt(opposingOrder.filledQuantity))
        ? remainingQuantity
        : (BigInt(opposingOrder.quantity) - BigInt(opposingOrder.filledQuantity));

      await this.executeTrade(order, opposingOrder, matchQuantity.toString(), pair);

      remainingQuantity -= matchQuantity;
    }

    if (remainingQuantity === BigInt(0)) {
      await updateOrderStatus(order.id, 'FILLED');
    } else if (remainingQuantity < BigInt(order.quantity)) {
      await updateOrderStatus(order.id, 'PARTIAL');
    } else {
      await this.addOrderToOrderBook(order);
    }
  }

  private canMatch(order: Order, opposingOrder: Order): boolean {
    if (order.orderType === 'MARKET') return true;
    if (!order.price || !opposingOrder.price) return false;

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
  ): Promise<void> {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tradePrice = opposingOrder.price!;
      const buyerOrder = order.side === 'BUY' ? order : opposingOrder;
      const sellerOrder = order.side === 'SELL' ? order : opposingOrder;

      const buyerFee = this.calculateFee(matchQuantity, tradePrice);
      const sellerFee = this.calculateFee(matchQuantity, tradePrice);

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

      await this.invalidateOrderBookCache(pair.id);
      await this.cacheRecentTrade(trade);

      await tradingEventPublisher.publishTradeExecuted(trade);
      await tradingEventPublisher.publishTradeSettlementPending(trade.id);

      await this.settlementQueue.add('execute-blockchain-settlement', {
        tradeId: trade.id,
        tradingPairId: pair.id
      });

      await this.notificationQueue.add('send-trade-notification', {
        buyerId: buyerOrder.userId,
        sellerId: sellerOrder.userId,
        tradeId: trade.id
      });

      await this.analyticsQueue.add('update-market-stats', {
        tradingPairId: pair.id,
        tradeId: trade.id
      });

      logger.info(
        { tradeId: trade.id, price: tradePrice, quantity: matchQuantity },
        'Trade executed'
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private aggregateOrderBook(orders: Order[]): OrderBookEntry[] {
    const priceMap = new Map<string, { quantity: bigint; count: number }>();

    for (const order of orders) {
      if (!order.price) continue;

      const existing = priceMap.get(order.price) || { quantity: BigInt(0), count: 0 };
      const unfilled = BigInt(order.quantity) - BigInt(order.filledQuantity);

      priceMap.set(order.price, {
        quantity: existing.quantity + unfilled,
        count: existing.count + 1
      });
    }

    return Array.from(priceMap.entries()).map(([price, data]) => ({
      price,
      quantity: data.quantity.toString(),
      orderCount: data.count
    }));
  }

  private calculateQuoteAmount(baseQuantity: string, price: string): string {
    return (BigInt(baseQuantity) * BigInt(price) / BigInt(10 ** 18)).toString();
  }

  private calculateFee(quantity: string, price: string): string {
    const feeRate = BigInt(25);
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

  private async validateOrderSize(pair: TradingPair, quantity: string): Promise<void> {
    if (pair.minOrderSize && BigInt(quantity) < BigInt(pair.minOrderSize)) {
      throw new ApplicationError('Order size below minimum', {
        statusCode: 400,
        code: 'order_too_small'
      });
    }

    if (pair.maxOrderSize && BigInt(quantity) > BigInt(pair.maxOrderSize)) {
      throw new ApplicationError('Order size above maximum', {
        statusCode: 400,
        code: 'order_too_large'
      });
    }
  }

  private async addOrderToOrderBook(order: Order): Promise<void> {
    const redis = getRedisClient();
    const key = `orderbook:${order.tradingPairId}:${order.side.toLowerCase()}s`;
    await redis.zadd(
      key,
      order.side === 'BUY' ? -Number(order.price) : Number(order.price),
      JSON.stringify(order)
    );
    await this.invalidateOrderBookCache(order.tradingPairId);
  }

  private async removeOrderFromOrderBook(order: Order): Promise<void> {
    const redis = getRedisClient();
    const key = `orderbook:${order.tradingPairId}:${order.side.toLowerCase()}s`;
    await redis.zrem(key, JSON.stringify(order));
    await this.invalidateOrderBookCache(order.tradingPairId);
  }

  private async cacheUserOrder(order: Order): Promise<void> {
    const redis = getRedisClient();
    await redis.lpush(`user:open-orders:${order.userId}`, order.id);
    await redis.expire(`user:open-orders:${order.userId}`, 300);
  }

  private async cacheOrderBook(orderBook: OrderBook): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `market:${orderBook.tradingPairId}:depth`,
      10,
      JSON.stringify(orderBook)
    );
  }

  private async getCachedOrderBook(tradingPairId: string): Promise<OrderBook | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`market:${tradingPairId}:depth`);
    return cached ? JSON.parse(cached) : null;
  }

  private async invalidateOrderBookCache(tradingPairId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`market:${tradingPairId}:depth`);
  }

  private async cacheRecentTrade(trade: Trade): Promise<void> {
    const redis = getRedisClient();
    await redis.lpush(`trades:recent:${trade.tradingPairId}`, JSON.stringify(trade));
    await redis.ltrim(`trades:recent:${trade.tradingPairId}`, 0, 99);
  }

  private async cacheMarketStats(stats: MarketStats): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `market:${stats.tradingPairId}:stats`,
      60,
      JSON.stringify(stats)
    );
  }

  private async getCachedMarketStats(tradingPairId: string): Promise<MarketStats | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`market:${tradingPairId}:stats`);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Validate RWA compliance for trading
   * Ensures market is active and user meets compliance requirements
   */
  private async validateRwaCompliance(
    marketId: string,
    userId: string,
    pair: TradingPair
  ): Promise<void> {
    // Check if market is active
    const market = await findMarketById(marketId);
    if (!market) {
      throw new ApplicationError('Market not found', {
        statusCode: 404,
        code: 'market_not_found'
      });
    }

    if (market.status !== 'active') {
      throw new ApplicationError('Market is not active for trading', {
        statusCode: 400,
        code: 'market_not_active',
        details: { marketStatus: market.status }
      });
    }

    // Get base token (RWA token) details
    const baseToken = await findTokenById(pair.baseTokenId);
    if (!baseToken) {
      throw new ApplicationError('Base token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    // For RWA tokens, verify compliance
    if (baseToken.tokenType === 'RWA') {
      try {
        await this.tokenService.verifyCompliance(userId, baseToken.id);
      } catch (error) {
        logger.warn(
          { userId, tokenId: baseToken.id, marketId, error },
          'RWA compliance check failed'
        );
        throw new ApplicationError('User does not meet RWA compliance requirements', {
          statusCode: 403,
          code: 'compliance_failed',
          details: {
            reason: error instanceof Error ? error.message : 'Compliance verification failed',
            tokenSymbol: baseToken.tokenSymbol,
            assetType: market.assetType
          }
        });
      }
    }

    logger.debug(
      { userId, marketId, tokenSymbol: baseToken.tokenSymbol },
      'RWA compliance validated'
    );
  }
}
