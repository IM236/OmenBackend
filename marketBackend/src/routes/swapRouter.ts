import { Router } from 'express';
import { asyncHandler } from '@lib/asyncHandler';
import {
  getSwapQuoteHandler,
  createSwapHandler,
  getSwapHandler,
  listSwapsHandler
} from '@controllers/swapController';

const swapRouter = Router();

swapRouter.post('/quote', asyncHandler(getSwapQuoteHandler));
swapRouter.post('/', asyncHandler(createSwapHandler));
swapRouter.get('/:swapId', asyncHandler(getSwapHandler));
swapRouter.get('/', asyncHandler(listSwapsHandler));

export { swapRouter };
