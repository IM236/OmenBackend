import { Router } from 'express';
import { asyncHandler } from '@lib/asyncHandler';
import {
  submitOrderHandler,
  cancelOrderHandler,
  getOrderHandler,
  getUserOrdersHandler,
  getOrderBookHandler,
  getMarketStatsHandler,
  getAllMarketStatsHandler,
  getRecentTradesHandler,
  getUserTradesHandler,
  getCandlesHandler,
  getTradingPairsHandler,
  getTradingPairHandler
} from '@controllers/tradingController';

const tradingRouter = Router();

tradingRouter.post('/orders', asyncHandler(submitOrderHandler));

tradingRouter.delete('/orders/:orderId', asyncHandler(cancelOrderHandler));

tradingRouter.get('/orders/:orderId', asyncHandler(getOrderHandler));

tradingRouter.get('/users/:userId/orders', asyncHandler(getUserOrdersHandler));

tradingRouter.get('/users/:userId/trades', asyncHandler(getUserTradesHandler));

tradingRouter.get('/pairs', asyncHandler(getTradingPairsHandler));

tradingRouter.get('/pairs/:pairId', asyncHandler(getTradingPairHandler));

tradingRouter.get('/pairs/:pairId/orderbook', asyncHandler(getOrderBookHandler));

tradingRouter.get('/pairs/:pairId/stats', asyncHandler(getMarketStatsHandler));

tradingRouter.get('/stats', asyncHandler(getAllMarketStatsHandler));

tradingRouter.get('/pairs/:pairId/trades', asyncHandler(getRecentTradesHandler));

tradingRouter.get('/pairs/:pairId/candles', asyncHandler(getCandlesHandler));

export { tradingRouter };
