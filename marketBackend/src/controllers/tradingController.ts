import { Request, Response } from 'express';
import { ApplicationError } from '@lib/errors';
import { getTradingService } from '@services/factory';
import { CreateOrderInput, OrderType } from '@app-types/trading';

export const submitOrderHandler = async (req: Request, res: Response) => {
  const {
    userId,
    userAddress,
    tradingPairId,
    side,
    orderKind,
    quantity,
    price,
    signature,
    nonce,
    expiry
  } = req.body;

  if (!userId || !userAddress || !tradingPairId || !side || !orderKind || !quantity || !signature || !nonce || !expiry) {
    throw new ApplicationError('Missing required fields', {
      statusCode: 400,
      code: 'missing_fields'
    });
  }

  if (side !== 'BUY' && side !== 'SELL') {
    throw new ApplicationError('Invalid side. Must be BUY or SELL', {
      statusCode: 400,
      code: 'invalid_side'
    });
  }

  const allowedOrderKinds: OrderType[] = ['LIMIT', 'MARKET', 'STOP_LIMIT'];
  if (!allowedOrderKinds.includes(orderKind)) {
    throw new ApplicationError('Invalid order kind. Must be LIMIT, MARKET, or STOP_LIMIT', {
      statusCode: 400,
      code: 'invalid_order_kind'
    });
  }

  const priceRequired = orderKind === 'LIMIT' || orderKind === 'STOP_LIMIT';
  if (priceRequired && !price) {
    throw new ApplicationError('Price is required for LIMIT and STOP_LIMIT orders', {
      statusCode: 400,
      code: 'price_required'
    });
  }

  const input: CreateOrderInput = {
    userId,
    userAddress,
    tradingPairId,
    side,
    orderType: orderKind,
    quantity,
    price: price || undefined,
    signature,
    nonce,
    expiry,
    timeInForce: req.body.timeInForce || 'GTC',
    metadata: req.body.metadata || {}
  };

  const tradingService = getTradingService();
  const order = await tradingService.submitOrder(input);

  res.status(201).json({
    success: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber.toString(),
      status: order.status,
      side: order.side,
      orderType: order.orderType,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      createdAt: order.createdAt
    }
  });
};

export const cancelOrderHandler = async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { userId } = req.body;

  if (!userId || !orderId) {
    throw new ApplicationError('Missing userId or oderId', {
      statusCode: 400,
      code: 'missing_user_id_or_order_id'
    });
  }

  const tradingService = getTradingService();
  const order = await tradingService.cancelOrder(orderId, userId);

  res.json({
    success: true,
    data: {
      orderId: order.id,
      status: order.status,
      updatedAt: order.updatedAt
    }
  });
};

export const getOrderHandler = async (req: Request, res: Response) => {
  const { orderId } = req.params;
  if (!orderId) {
    throw new ApplicationError('must add orderID to request', {
      statusCode: 404,
      code: 'no_order_id'
    });
  }

  const tradingService = getTradingService();
  const order = await tradingService.getOrderById(orderId);

  if (!order) {
    throw new ApplicationError('Order not found', {
      statusCode: 404,
      code: 'order_not_found'
    });
  }

  res.json({
    success: true,
    data: order
  });
};

export const getUserOrdersHandler = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { status } = req.query;
   if (!userId) {
    throw new ApplicationError('Missing userId', {
      statusCode: 400,
      code: 'missing_user_id'
    });
  }

  const tradingService = getTradingService();
  const orders = await tradingService.getUserOrders(
    userId,
    status as any
  );

  res.json({
    success: true,
    data: orders
  });
};

export const getOrderBookHandler = async (req: Request, res: Response) => {
  const { pairId } = req.params;
   if (!pairId) {
    throw new ApplicationError('Missing userId', {
      statusCode: 400,
      code: 'missing_pair_id'
    });
  }

  const tradingService = getTradingService();
  const orderBook = await tradingService.getOrderBook(pairId);

  res.json({
    success: true,
    data: orderBook
  });
};

export const getMarketStatsHandler = async (req: Request, res: Response) => {
  const { pairId } = req.params;

  if (!pairId) {
    throw new ApplicationError('Missing userId', {
      statusCode: 400,
      code: 'missing_pair_id'
    });
  }

  const tradingService = getTradingService();
  const stats = await tradingService.getMarketStats(pairId);

  if (!stats) {
    throw new ApplicationError('Market stats not found', {
      statusCode: 404,
      code: 'stats_not_found'
    });
  }

  res.json({
    success: true,
    data: stats
  });
};

export const getAllMarketStatsHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
};

export const getRecentTradesHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
};

export const getUserTradesHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
};

export const getCandlesHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
};

export const getTradingPairsHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
};

export const getTradingPairHandler = async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {}
  });
};
