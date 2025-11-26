import { Router } from 'express';
import { asyncHandler } from '@lib/asyncHandler';
import {
  createTokenHandler,
  getTokenHandler,
  listTokensHandler,
  mintTokenHandler,
  transferTokenHandler,
  getUserBalanceHandler,
  getUserBalancesHandler,
  updateComplianceHandler
} from '@controllers/tokenController';

const tokenRouter = Router();

tokenRouter.post('/', asyncHandler(createTokenHandler));

tokenRouter.get('/', asyncHandler(listTokensHandler));

tokenRouter.get('/:tokenId', asyncHandler(getTokenHandler));

tokenRouter.post('/:tokenId/mint', asyncHandler(mintTokenHandler));

tokenRouter.post('/:tokenId/transfer', asyncHandler(transferTokenHandler));

tokenRouter.get('/balances/:userId', asyncHandler(getUserBalancesHandler));

tokenRouter.get('/balances/:userId/:tokenId', asyncHandler(getUserBalanceHandler));

tokenRouter.post('/compliance/:userId', asyncHandler(updateComplianceHandler));

export { tokenRouter };
