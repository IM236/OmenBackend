import { Router } from 'express';
import { asyncHandler } from '@lib/asyncHandler';
import {
  getWrapQuoteHandler,
  getUnwrapQuoteHandler,
  wrapAssetHandler,
  unwrapAssetHandler,
  getTransactionStatusHandler,
  listTransactionsHandler
} from '@controllers/wrapperController';

/**
 * Wrapper Router - Routes for wrapping tokenized assets into USDC via Sapphire
 *
 * Base path: /api/v1/wrapper
 */
const wrapperRouter = Router();

// Quote endpoints
wrapperRouter.post('/quote/wrap', asyncHandler(getWrapQuoteHandler));
wrapperRouter.post('/quote/unwrap', asyncHandler(getUnwrapQuoteHandler));

// Wrap/Unwrap operations
wrapperRouter.post('/wrap', asyncHandler(wrapAssetHandler));
wrapperRouter.post('/unwrap', asyncHandler(unwrapAssetHandler));

// Transaction management
wrapperRouter.get('/transactions/:id', asyncHandler(getTransactionStatusHandler));
wrapperRouter.get('/transactions', asyncHandler(listTransactionsHandler));

export { wrapperRouter };
