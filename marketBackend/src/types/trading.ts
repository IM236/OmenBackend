export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT';
export type OrderStatus = 'PENDING_MATCH' | 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type SettlementStatus = 'PENDING' | 'SETTLED' | 'FAILED';

export interface TradingPair {
  id: string;
  marketId: string | null;
  baseTokenId: string;
  quoteTokenId: string;
  pairSymbol: string;
  isActive: boolean;
  minOrderSize: string | null;
  maxOrderSize: string | null;
  pricePrecision: number;
  quantityPrecision: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  orderNumber: bigint;
  userId: string;
  tradingPairId: string;
  side: OrderSide;
  orderType: OrderType;
  status: OrderStatus;
  price: string | null;
  quantity: string;
  filledQuantity: string;
  averageFillPrice: string | null;
  timeInForce: TimeInForce;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trade {
  id: string;
  tradeNumber: bigint;
  tradingPairId: string;
  buyerOrderId: string;
  sellerOrderId: string;
  buyerId: string;
  sellerId: string;
  price: string;
  quantity: string;
  buyerFee: string;
  sellerFee: string;
  settlementStatus: SettlementStatus;
  blockchainTxHash: string | null;
  executedAt: Date;
  settledAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface PriceCandle {
  id: string;
  tradingPairId: string;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  quoteVolume: string;
  tradesCount: number;
  timestamp: Date;
}

export interface MarketStats {
  id: string;
  tradingPairId: string;
  lastPrice: string | null;
  priceChange24h: string | null;
  priceChangePercent24h: string | null;
  high24h: string | null;
  low24h: string | null;
  volume24h: string | null;
  quoteVolume24h: string | null;
  tradesCount24h: number;
  updatedAt: Date;
}

export interface CreateOrderInput {
  userId: string;
  userAddress: string;
  tradingPairId: string;
  side: OrderSide;
  orderType: OrderType;
  price?: string;
  quantity: string;
  timeInForce?: TimeInForce;
  signature: string;
  nonce: string;
  expiry: number;
  metadata?: Record<string, unknown>;
}

export interface OrderBookEntry {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface OrderBook {
  tradingPairId: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastUpdate: Date;
}
