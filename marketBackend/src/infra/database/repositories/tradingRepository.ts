import { getDatabasePool } from '@infra/database';
import {
  TradingPair,
  Order,
  Trade,
  OrderStatus,
  CreateOrderInput,
  MarketStats,
  PriceCandle
} from '@app-types/trading';

export const findTradingPairById = async (pairId: string): Promise<TradingPair | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM trading_pairs WHERE id = $1', [pairId]);
  return result.rows.length > 0 ? mapTradingPairRow(result.rows[0]) : null;
};

export const findTradingPairBySymbol = async (symbol: string): Promise<TradingPair | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM trading_pairs WHERE pair_symbol = $1', [symbol]);
  return result.rows.length > 0 ? mapTradingPairRow(result.rows[0]) : null;
};

export const listActiveTradingPairs = async (): Promise<TradingPair[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM trading_pairs WHERE is_active = true ORDER BY created_at DESC'
  );
  return result.rows.map(mapTradingPairRow);
};

export const createOrder = async (
  input: CreateOrderInput & { orderNumber?: bigint }
): Promise<Order> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO orders (
       user_id, trading_pair_id, side, order_type, price, quantity, time_in_force, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.userId,
      input.tradingPairId,
      input.side,
      input.orderType,
      input.price || null,
      input.quantity,
      input.timeInForce || 'GTC',
      JSON.stringify(input.metadata || {})
    ]
  );
  return mapOrderRow(result.rows[0]);
};

export const updateOrderStatus = async (
  orderId: string,
  status: OrderStatus,
  filledQuantity?: string,
  averageFillPrice?: string
): Promise<Order> => {
  const pool = getDatabasePool();

  const updates: string[] = ['status = $2', 'updated_at = NOW()'];
  const params: any[] = [orderId, status];
  let paramIndex = 3;

  if (filledQuantity !== undefined) {
    updates.push(`filled_quantity = $${paramIndex}`);
    params.push(filledQuantity);
    paramIndex++;
  }

  if (averageFillPrice !== undefined) {
    updates.push(`average_fill_price = $${paramIndex}`);
    params.push(averageFillPrice);
    paramIndex++;
  }

  const result = await pool.query(
    `UPDATE orders SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    throw new Error('Order not found');
  }

  return mapOrderRow(result.rows[0]);
};

export const findOrderById = async (orderId: string): Promise<Order | null> => {
  const pool = getDatabasePool();
  const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return result.rows.length > 0 ? mapOrderRow(result.rows[0]) : null;
};

export const getUserOrders = async (
  userId: string,
  status?: OrderStatus
): Promise<Order[]> => {
  const pool = getDatabasePool();
  const query = status
    ? 'SELECT * FROM orders WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC'
    : 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
  const params = status ? [userId, status] : [userId];
  const result = await pool.query(query, params);
  return result.rows.map(mapOrderRow);
};

export const getOpenOrdersForPair = async (
  tradingPairId: string,
  side: 'BUY' | 'SELL',
  limit: number = 50
): Promise<Order[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT * FROM orders
     WHERE trading_pair_id = $1
       AND side = $2
       AND status IN ('OPEN', 'PARTIAL')
     ORDER BY price ${side === 'BUY' ? 'DESC' : 'ASC'}, created_at ASC
     LIMIT $3`,
    [tradingPairId, side, limit]
  );
  return result.rows.map(mapOrderRow);
};

export const createTrade = async (data: {
  tradingPairId: string;
  buyerOrderId: string;
  sellerOrderId: string;
  buyerId: string;
  sellerId: string;
  price: string;
  quantity: string;
  buyerFee: string;
  sellerFee: string;
  metadata?: Record<string, unknown>;
}): Promise<Trade> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO trades (
       trading_pair_id, buyer_order_id, seller_order_id, buyer_id, seller_id,
       price, quantity, buyer_fee, seller_fee, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.tradingPairId,
      data.buyerOrderId,
      data.sellerOrderId,
      data.buyerId,
      data.sellerId,
      data.price,
      data.quantity,
      data.buyerFee,
      data.sellerFee,
      JSON.stringify(data.metadata || {})
    ]
  );
  return mapTradeRow(result.rows[0]);
};

export const updateTradeSettlement = async (
  tradeId: string,
  status: 'SETTLED' | 'FAILED',
  blockchainTxHash?: string
): Promise<Trade> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `UPDATE trades
     SET settlement_status = $2,
         blockchain_tx_hash = $3,
         settled_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [tradeId, status, blockchainTxHash || null]
  );

  if (result.rows.length === 0) {
    throw new Error('Trade not found');
  }

  return mapTradeRow(result.rows[0]);
};

export const getTradesByPair = async (
  tradingPairId: string,
  limit: number = 100
): Promise<Trade[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM trades WHERE trading_pair_id = $1 ORDER BY executed_at DESC LIMIT $2',
    [tradingPairId, limit]
  );
  return result.rows.map(mapTradeRow);
};

export const getUserTrades = async (userId: string, limit: number = 100): Promise<Trade[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT * FROM trades
     WHERE buyer_id = $1 OR seller_id = $1
     ORDER BY executed_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(mapTradeRow);
};

export const getMarketStats = async (tradingPairId: string): Promise<MarketStats | null> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM market_stats WHERE trading_pair_id = $1',
    [tradingPairId]
  );
  return result.rows.length > 0 ? mapMarketStatsRow(result.rows[0]) : null;
};

export const upsertMarketStats = async (data: Omit<MarketStats, 'id'>): Promise<MarketStats> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO market_stats (
       trading_pair_id, last_price, price_change_24h, price_change_percent_24h,
       high_24h, low_24h, volume_24h, quote_volume_24h, trades_count_24h
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (trading_pair_id)
     DO UPDATE SET
       last_price = $2,
       price_change_24h = $3,
       price_change_percent_24h = $4,
       high_24h = $5,
       low_24h = $6,
       volume_24h = $7,
       quote_volume_24h = $8,
       trades_count_24h = $9,
       updated_at = NOW()
     RETURNING *`,
    [
      data.tradingPairId,
      data.lastPrice,
      data.priceChange24h,
      data.priceChangePercent24h,
      data.high24h,
      data.low24h,
      data.volume24h,
      data.quoteVolume24h,
      data.tradesCount24h
    ]
  );
  return mapMarketStatsRow(result.rows[0]);
};

export const getPriceCandles = async (
  tradingPairId: string,
  interval: PriceCandle['interval'],
  startTime: Date,
  endTime: Date
): Promise<PriceCandle[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `SELECT * FROM price_candles
     WHERE trading_pair_id = $1
       AND interval = $2
       AND timestamp >= $3
       AND timestamp <= $4
     ORDER BY timestamp ASC`,
    [tradingPairId, interval, startTime, endTime]
  );
  return result.rows.map(mapCandleRow);
};

export const insertAuditLog = async (data: {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  orderId?: string;
  tradeId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> => {
  const pool = getDatabasePool();
  await pool.query(
    `INSERT INTO audit_log (
       user_id, action, resource_type, resource_id, order_id, trade_id, details, ip_address, user_agent
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.userId || null,
      data.action,
      data.resourceType,
      data.resourceId || null,
      data.orderId || null,
      data.tradeId || null,
      JSON.stringify(data.details || {}),
      data.ipAddress || null,
      data.userAgent || null
    ]
  );
};

const mapTradingPairRow = (row: any): TradingPair => ({
  id: row.id,
  baseTokenId: row.base_token_id,
  quoteTokenId: row.quote_token_id,
  pairSymbol: row.pair_symbol,
  isActive: row.is_active,
  minOrderSize: row.min_order_size,
  maxOrderSize: row.max_order_size,
  pricePrecision: row.price_precision,
  quantityPrecision: row.quantity_precision,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapOrderRow = (row: any): Order => ({
  id: row.id,
  orderNumber: BigInt(row.order_number),
  userId: row.user_id,
  tradingPairId: row.trading_pair_id,
  side: row.side,
  orderType: row.order_type,
  status: row.status,
  price: row.price,
  quantity: row.quantity,
  filledQuantity: row.filled_quantity,
  averageFillPrice: row.average_fill_price,
  timeInForce: row.time_in_force,
  metadata: row.metadata,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapTradeRow = (row: any): Trade => ({
  id: row.id,
  tradeNumber: BigInt(row.trade_number),
  tradingPairId: row.trading_pair_id,
  buyerOrderId: row.buyer_order_id,
  sellerOrderId: row.seller_order_id,
  buyerId: row.buyer_id,
  sellerId: row.seller_id,
  price: row.price,
  quantity: row.quantity,
  buyerFee: row.buyer_fee,
  sellerFee: row.seller_fee,
  settlementStatus: row.settlement_status,
  blockchainTxHash: row.blockchain_tx_hash,
  executedAt: row.executed_at,
  settledAt: row.settled_at,
  metadata: row.metadata
});

const mapMarketStatsRow = (row: any): MarketStats => ({
  id: row.id,
  tradingPairId: row.trading_pair_id,
  lastPrice: row.last_price,
  priceChange24h: row.price_change_24h,
  priceChangePercent24h: row.price_change_percent_24h,
  high24h: row.high_24h,
  low24h: row.low_24h,
  volume24h: row.volume_24h,
  quoteVolume24h: row.quote_volume_24h,
  tradesCount24h: row.trades_count_24h,
  updatedAt: row.updated_at
});

const mapCandleRow = (row: any): PriceCandle => ({
  id: row.id,
  tradingPairId: row.trading_pair_id,
  interval: row.interval,
  openPrice: row.open_price,
  highPrice: row.high_price,
  lowPrice: row.low_price,
  closePrice: row.close_price,
  volume: row.volume,
  quoteVolume: row.quote_volume,
  tradesCount: row.trades_count,
  timestamp: row.timestamp
});
