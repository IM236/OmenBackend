import { logger } from '@infra/logging/logger';
import { getRedisClient } from '@infra/redis';
import { ApplicationError } from '@lib/errors';
import {
  TradingPair,
  PriceCandle,
  MarketStats,
  Trade
} from '@types/trading';
import {
  findTradingPairById,
  findTradingPairBySymbol,
  listActiveTradingPairs,
  getTradesByPair,
  getPriceCandles,
  getMarketStats,
  upsertMarketStats
} from '@infra/database/repositories/tradingRepository';
import { Queue } from 'bullmq';

export interface MarketDataUpdate {
  tradingPairId: string;
  price: string;
  volume24h: string;
  timestamp: Date;
}

export class MarketDataService {
  constructor(
    private readonly externalPriceQueue: Queue,
    private readonly candleAggregationQueue: Queue,
    private readonly metadataUpdateQueue: Queue
  ) {}

  async getTradingPair(pairId: string): Promise<TradingPair | null> {
    const cached = await this.getCachedTradingPair(pairId);
    if (cached) {
      return cached;
    }

    const pair = await findTradingPairById(pairId);
    if (pair) {
      await this.cacheTradingPair(pair);
    }
    return pair;
  }

  async getTradingPairBySymbol(symbol: string): Promise<TradingPair | null> {
    const pair = await findTradingPairBySymbol(symbol);
    if (pair) {
      await this.cacheTradingPair(pair);
    }
    return pair;
  }

  async listTradingPairs(): Promise<TradingPair[]> {
    const cached = await this.getCachedTradingPairsList();
    if (cached) {
      return cached;
    }

    const pairs = await listActiveTradingPairs();
    await this.cacheTradingPairsList(pairs);
    return pairs;
  }

  async getCurrentPrice(tradingPairId: string): Promise<string | null> {
    const cached = await this.getCachedPrice(tradingPairId);
    if (cached) {
      return cached;
    }

    const stats = await getMarketStats(tradingPairId);
    if (stats?.lastPrice) {
      await this.cachePrice(tradingPairId, stats.lastPrice);
      return stats.lastPrice;
    }

    return null;
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

  async getAllMarketStats(): Promise<MarketStats[]> {
    const pairs = await listActiveTradingPairs();
    const statsPromises = pairs.map(pair => this.getMarketStats(pair.id));
    const allStats = await Promise.all(statsPromises);
    return allStats.filter((s): s is MarketStats => s !== null);
  }

  async getRecentTrades(tradingPairId: string, limit: number = 100): Promise<Trade[]> {
    const cached = await this.getCachedRecentTrades(tradingPairId, limit);
    if (cached) {
      return cached;
    }

    const trades = await getTradesByPair(tradingPairId, limit);
    await this.cacheRecentTrades(tradingPairId, trades);
    return trades;
  }

  async getCandles(
    tradingPairId: string,
    interval: PriceCandle['interval'],
    startTime: Date,
    endTime: Date
  ): Promise<PriceCandle[]> {
    const cacheKey = `candles:${tradingPairId}:${interval}:${startTime.getTime()}:${endTime.getTime()}`;
    const cached = await this.getCachedCandles(cacheKey);
    if (cached) {
      return cached;
    }

    const candles = await getPriceCandles(tradingPairId, interval, startTime, endTime);
    await this.cacheCandles(cacheKey, candles);
    return candles;
  }

  async updateMarketStatsForTrade(trade: Trade): Promise<void> {
    const currentStats = await getMarketStats(trade.tradingPairId);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const trades24h = await getTradesByPair(trade.tradingPairId, 10000);
    const recentTrades = trades24h.filter(t => t.executedAt >= oneDayAgo);

    const volume24h = recentTrades.reduce(
      (sum, t) => sum + BigInt(t.quantity),
      BigInt(0)
    ).toString();

    const quoteVolume24h = recentTrades.reduce(
      (sum, t) => sum + (BigInt(t.quantity) * BigInt(t.price) / BigInt(10 ** 18)),
      BigInt(0)
    ).toString();

    const high24h = recentTrades.reduce(
      (max, t) => BigInt(t.price) > BigInt(max) ? t.price : max,
      currentStats?.high24h || '0'
    );

    const low24h = recentTrades.reduce(
      (min, t) => {
        if (min === '0' || BigInt(t.price) < BigInt(min)) return t.price;
        return min;
      },
      currentStats?.low24h || '0'
    );

    const priceChange24h = currentStats?.lastPrice
      ? (BigInt(trade.price) - BigInt(currentStats.lastPrice)).toString()
      : '0';

    const priceChangePercent24h = currentStats?.lastPrice && currentStats.lastPrice !== '0'
      ? ((BigInt(priceChange24h) * BigInt(10000)) / BigInt(currentStats.lastPrice)).toString()
      : '0';

    const updatedStats = await upsertMarketStats({
      tradingPairId: trade.tradingPairId,
      lastPrice: trade.price,
      priceChange24h,
      priceChangePercent24h,
      high24h,
      low24h,
      volume24h,
      quoteVolume24h,
      tradesCount24h: recentTrades.length,
      updatedAt: new Date()
    });

    await this.cacheMarketStats(updatedStats);
    await this.cachePrice(trade.tradingPairId, trade.price);

    logger.info(
      { tradingPairId: trade.tradingPairId, price: trade.price },
      'Market stats updated'
    );
  }

  async schedulePriceFetch(): Promise<void> {
    const pairs = await listActiveTradingPairs();

    for (const pair of pairs) {
      await this.externalPriceQueue.add(
        'fetch-external-prices',
        { tradingPairId: pair.id, pairSymbol: pair.pairSymbol },
        { repeat: { every: 10000 } }
      );
    }

    logger.info({ pairsCount: pairs.length }, 'Scheduled external price fetching');
  }

  async scheduleCandleAggregation(): Promise<void> {
    const pairs = await listActiveTradingPairs();
    const intervals: PriceCandle['interval'][] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

    for (const pair of pairs) {
      for (const interval of intervals) {
        await this.candleAggregationQueue.add(
          'aggregate-candles',
          { tradingPairId: pair.id, interval },
          { repeat: { pattern: this.getCronPattern(interval) } }
        );
      }
    }

    logger.info('Scheduled candle aggregation jobs');
  }

  private getCronPattern(interval: PriceCandle['interval']): string {
    switch (interval) {
      case '1m': return '* * * * *';
      case '5m': return '*/5 * * * *';
      case '15m': return '*/15 * * * *';
      case '1h': return '0 * * * *';
      case '4h': return '0 */4 * * *';
      case '1d': return '0 0 * * *';
      case '1w': return '0 0 * * 0';
      default: return '* * * * *';
    }
  }

  private async cacheTradingPair(pair: TradingPair): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `trading-pair:${pair.id}`,
      3600,
      JSON.stringify(pair)
    );
  }

  private async getCachedTradingPair(pairId: string): Promise<TradingPair | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`trading-pair:${pairId}`);
    return cached ? JSON.parse(cached) : null;
  }

  private async cacheTradingPairsList(pairs: TradingPair[]): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      'trading-pairs:list',
      300,
      JSON.stringify(pairs)
    );
  }

  private async getCachedTradingPairsList(): Promise<TradingPair[] | null> {
    const redis = getRedisClient();
    const cached = await redis.get('trading-pairs:list');
    return cached ? JSON.parse(cached) : null;
  }

  private async cachePrice(tradingPairId: string, price: string): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `market:${tradingPairId}:price`,
      10,
      JSON.stringify({ price, timestamp: new Date() })
    );
  }

  private async getCachedPrice(tradingPairId: string): Promise<string | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`market:${tradingPairId}:price`);
    if (cached) {
      const data = JSON.parse(cached);
      return data.price;
    }
    return null;
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

  private async cacheRecentTrades(tradingPairId: string, trades: Trade[]): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `trades:recent:${tradingPairId}`,
      30,
      JSON.stringify(trades)
    );
  }

  private async getCachedRecentTrades(tradingPairId: string, limit: number): Promise<Trade[] | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`trades:recent:${tradingPairId}`);
    if (cached) {
      const trades: Trade[] = JSON.parse(cached);
      return trades.slice(0, limit);
    }
    return null;
  }

  private async cacheCandles(cacheKey: string, candles: PriceCandle[]): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(cacheKey, 300, JSON.stringify(candles));
  }

  private async getCachedCandles(cacheKey: string): Promise<PriceCandle[] | null> {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }
}
