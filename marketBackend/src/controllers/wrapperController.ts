import { Request, Response } from 'express';
import { WrapperService } from '@services/wrapperService';
import { ApplicationError } from '@lib/errors';
import { WrapRequest, UnwrapRequest } from '@app-types/wrapper';

/**
 * Wrapper Controller - Tokenized Asset <-> USDC Wrapping via Sapphire
 *
 * Endpoints:
 * 1. POST /wrapper/quote/wrap - Get quote for wrapping tokens into USDC
 * 2. POST /wrapper/quote/unwrap - Get quote for unwrapping USDC into tokens
 * 3. POST /wrapper/wrap - Execute wrap operation
 * 4. POST /wrapper/unwrap - Execute unwrap operation
 * 5. GET /wrapper/transactions/:id - Get transaction status
 */

// TODO: Initialize with actual queue instances
// For now, this is a placeholder - should be initialized in server setup
let wrapperService: WrapperService;

export const setWrapperService = (service: WrapperService) => {
  wrapperService = service;
};

/**
 * Get quote for wrapping tokens into USDC
 *
 * POST /api/v1/wrapper/quote/wrap
 *
 * Body:
 * {
 *   "tokenId": "token-uuid",
 *   "amount": "1000000000000000000"
 * }
 *
 * Response:
 * {
 *   "data": {
 *     "tokenId": "token-uuid",
 *     "tokenAmount": "1000000000000000000",
 *     "usdcAmount": "100000000",
 *     "exchangeRate": "100.00",
 *     "fees": {
 *       "platformFee": "500000",
 *       "networkFee": "1000000",
 *       "totalFee": "1500000"
 *     },
 *     "expiresAt": "2025-11-27T12:05:00Z"
 *   }
 * }
 */
export const getWrapQuoteHandler = async (req: Request, res: Response) => {
  if (!wrapperService) {
    throw new ApplicationError('Wrapper service not initialized', {
      statusCode: 500,
      code: 'service_not_initialized'
    });
  }

  const { tokenId, amount } = req.body;

  if (!tokenId || !amount) {
    throw new ApplicationError('Missing required fields', {
      statusCode: 400,
      code: 'missing_fields',
      details: { required: ['tokenId', 'amount'] }
    });
  }

  const quote = await wrapperService.getWrapQuote(tokenId, amount);

  res.json({
    data: quote,
    message: 'Wrap quote generated successfully'
  });
};

/**
 * Get quote for unwrapping USDC into tokens
 *
 * POST /api/v1/wrapper/quote/unwrap
 *
 * Body:
 * {
 *   "tokenId": "token-uuid",
 *   "usdcAmount": "100000000"
 * }
 *
 * Response:
 * {
 *   "data": {
 *     "tokenId": "token-uuid",
 *     "tokenAmount": "1000000000000000000",
 *     "usdcAmount": "100000000",
 *     "exchangeRate": "100.00",
 *     "fees": {
 *       "platformFee": "500000",
 *       "networkFee": "1000000",
 *       "totalFee": "1500000"
 *     },
 *     "expiresAt": "2025-11-27T12:05:00Z"
 *   }
 * }
 */
export const getUnwrapQuoteHandler = async (req: Request, res: Response) => {
  if (!wrapperService) {
    throw new ApplicationError('Wrapper service not initialized', {
      statusCode: 500,
      code: 'service_not_initialized'
    });
  }

  const { tokenId, usdcAmount } = req.body;

  if (!tokenId || !usdcAmount) {
    throw new ApplicationError('Missing required fields', {
      statusCode: 400,
      code: 'missing_fields',
      details: { required: ['tokenId', 'usdcAmount'] }
    });
  }

  const quote = await wrapperService.getUnwrapQuote(tokenId, usdcAmount);

  res.json({
    data: quote,
    message: 'Unwrap quote generated successfully'
  });
};

/**
 * Wrap tokenized asset into USDC
 *
 * POST /api/v1/wrapper/wrap
 *
 * Body:
 * {
 *   "userId": "user-uuid",
 *   "tokenId": "token-uuid",
 *   "amount": "1000000000000000000",
 *   "destinationAddress": "0x...",
 *   "metadata": {}
 * }
 *
 * Response:
 * {
 *   "data": {
 *     "transactionId": "wrap_1234567890_abc123"
 *   },
 *   "message": "Wrap transaction initiated"
 * }
 */
export const wrapAssetHandler = async (req: Request, res: Response) => {
  if (!wrapperService) {
    throw new ApplicationError('Wrapper service not initialized', {
      statusCode: 500,
      code: 'service_not_initialized'
    });
  }

  const { userId, tokenId, amount, destinationAddress, metadata } = req.body;

  if (!userId || !tokenId || !amount) {
    throw new ApplicationError('Missing required fields', {
      statusCode: 400,
      code: 'missing_fields',
      details: { required: ['userId', 'tokenId', 'amount'] }
    });
  }

  // Validate amount is a valid number string
  try {
    BigInt(amount);
  } catch (error) {
    throw new ApplicationError('Invalid amount format', {
      statusCode: 400,
      code: 'invalid_amount'
    });
  }

  const wrapRequest: WrapRequest = {
    userId,
    tokenId,
    amount,
    destinationAddress,
    metadata
  };

  const result = await wrapperService.wrapAsset(wrapRequest);

  res.status(202).json({
    data: result,
    message: 'Wrap transaction initiated successfully'
  });
};

/**
 * Unwrap USDC into tokenized asset
 *
 * POST /api/v1/wrapper/unwrap
 *
 * Body:
 * {
 *   "userId": "user-uuid",
 *   "usdcAmount": "100000000",
 *   "targetTokenId": "token-uuid",
 *   "destinationAddress": "0x...",
 *   "metadata": {}
 * }
 *
 * Response:
 * {
 *   "data": {
 *     "transactionId": "wrap_1234567890_xyz789"
 *   },
 *   "message": "Unwrap transaction initiated"
 * }
 */
export const unwrapAssetHandler = async (req: Request, res: Response) => {
  if (!wrapperService) {
    throw new ApplicationError('Wrapper service not initialized', {
      statusCode: 500,
      code: 'service_not_initialized'
    });
  }

  const { userId, usdcAmount, targetTokenId, destinationAddress, metadata } = req.body;

  if (!userId || !usdcAmount || !targetTokenId) {
    throw new ApplicationError('Missing required fields', {
      statusCode: 400,
      code: 'missing_fields',
      details: { required: ['userId', 'usdcAmount', 'targetTokenId'] }
    });
  }

  // Validate usdcAmount is a valid number string
  try {
    BigInt(usdcAmount);
  } catch (error) {
    throw new ApplicationError('Invalid USDC amount format', {
      statusCode: 400,
      code: 'invalid_amount'
    });
  }

  const unwrapRequest: UnwrapRequest = {
    userId,
    usdcAmount,
    targetTokenId,
    destinationAddress,
    metadata
  };

  const result = await wrapperService.unwrapAsset(unwrapRequest);

  res.status(202).json({
    data: result,
    message: 'Unwrap transaction initiated successfully'
  });
};

/**
 * Get transaction status
 *
 * GET /api/v1/wrapper/transactions/:id
 *
 * Response:
 * {
 *   "data": {
 *     "id": "wrap_1234567890_abc123",
 *     "userId": "user-uuid",
 *     "tokenId": "token-uuid",
 *     "tokenAmount": "1000000000000000000",
 *     "usdcAmount": "100000000",
 *     "exchangeRate": "100.00",
 *     "status": "PROCESSING",
 *     "sapphireTransactionId": "sph_tx_123",
 *     "blockchainTxHash": null,
 *     "failureReason": null,
 *     "metadata": {},
 *     "createdAt": "2025-11-27T12:00:00Z",
 *     "updatedAt": "2025-11-27T12:01:00Z",
 *     "completedAt": null
 *   }
 * }
 */
export const getTransactionStatusHandler = async (req: Request, res: Response) => {
  if (!wrapperService) {
    throw new ApplicationError('Wrapper service not initialized', {
      statusCode: 500,
      code: 'service_not_initialized'
    });
  }

  const { id } = req.params;

  if (!id) {
    throw new ApplicationError('Transaction ID is required', {
      statusCode: 400,
      code: 'missing_transaction_id'
    });
  }

  const transaction = await wrapperService.getTransactionStatus(id);

  if (!transaction) {
    throw new ApplicationError('Transaction not found', {
      statusCode: 404,
      code: 'transaction_not_found'
    });
  }

  res.json({
    data: transaction
  });
};

/**
 * List user's wrap/unwrap transactions
 *
 * GET /api/v1/wrapper/transactions?userId=xxx&status=COMPLETED&page=1&pageSize=25
 *
 * Response:
 * {
 *   "data": {
 *     "transactions": [...],
 *     "pagination": {
 *       "page": 1,
 *       "pageSize": 25,
 *       "total": 100
 *     }
 *   }
 * }
 */
export const listTransactionsHandler = async (req: Request, res: Response) => {
  // TODO: Implement listing from database
  // This would query the wrap/unwrap transaction tables with filters

  res.status(501).json({
    error: 'Not implemented yet',
    message: 'Transaction listing will be implemented with database queries'
  });
};
