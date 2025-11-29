import { Request, Response } from 'express';
import { ApplicationError } from '@lib/errors';
import { getSwapService } from '@services/factory';

export const getSwapQuoteHandler = async (req: Request, res: Response) => {
  const { sourceTokenId, targetTokenId, sourceAmount } = req.body;

  if (!sourceTokenId || !targetTokenId || !sourceAmount) {
    throw new ApplicationError('Missing required fields for swap quote', {
      statusCode: 400,
      code: 'swap_quote_missing_fields',
      details: { required: ['sourceTokenId', 'targetTokenId', 'sourceAmount'] }
    });
  }

  const swapService = getSwapService();
  const quote = await swapService.generateQuote({
    sourceTokenId,
    targetTokenId,
    sourceAmount
  });

  res.json({
    data: quote,
    message: 'Swap quote generated'
  });
};

export const createSwapHandler = async (req: Request, res: Response) => {
  const {
    userId,
    sourceTokenId,
    targetTokenId,
    sourceAmount,
    sourceChain,
    targetChain,
    minTargetAmount,
    destinationAddress,
    bridgeContractAddress,
    metadata,
    quote
  } = req.body;

  if (
    !userId ||
    !sourceTokenId ||
    !targetTokenId ||
    !sourceAmount ||
    !sourceChain ||
    !targetChain ||
    !destinationAddress ||
    !bridgeContractAddress
  ) {
    throw new ApplicationError('Missing required fields for swap creation', {
      statusCode: 400,
      code: 'swap_missing_fields',
      details: {
        required: [
          'userId',
          'sourceTokenId',
          'targetTokenId',
          'sourceAmount',
          'sourceChain',
          'targetChain',
          'destinationAddress',
          'bridgeContractAddress'
        ]
      }
    });
  }

  const swapService = getSwapService();
  const swap = await swapService.requestSwap({
    userId,
    sourceTokenId,
    targetTokenId,
    sourceAmount,
    sourceChain,
    targetChain,
    minTargetAmount,
    destinationAddress,
    bridgeContractAddress,
    metadata,
    quote
  });

  res.status(202).json({
    data: swap,
    message: 'Swap request accepted'
  });
};

export const getSwapHandler = async (req: Request, res: Response) => {
  const { swapId } = req.params as { swapId: string };

  if (!swapId) {
    throw new ApplicationError('Swap ID is required', {
      statusCode: 400,
      code: 'swap_missing_id'
    });
  }

  const swapService = getSwapService();
  const swap = await swapService.getSwapById(swapId);

  if (!swap) {
    throw new ApplicationError('Swap not found', {
      statusCode: 404,
      code: 'swap_not_found'
    });
  }

  res.json({
    data: swap
  });
};

export const listSwapsHandler = async (req: Request, res: Response) => {
  const { userId, limit } = req.query as { userId?: string; limit?: string };

  if (!userId) {
    throw new ApplicationError('userId query parameter is required', {
      statusCode: 400,
      code: 'swap_missing_user'
    });
  }

  const parsedLimit = limit ? Number(limit) : undefined;
  if (parsedLimit !== undefined && Number.isNaN(parsedLimit)) {
    throw new ApplicationError('Limit must be a number', {
      statusCode: 400,
      code: 'swap_invalid_limit'
    });
  }

  const swapService = getSwapService();
  const swaps = await swapService.listUserSwaps(userId, parsedLimit);

  res.json({
    data: swaps
  });
};
