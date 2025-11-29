import { Job, Queue } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import {
  CreateSwapInput,
  SwapJobPayload,
  SwapRecord,
  SwapQuote,
  SwapStatus
} from '@app-types/swap';
import {
  createSwapRequest,
  updateSwapStatus,
  markSwapProcessing,
  markSwapCompleted,
  markSwapFailed,
  findSwapById,
  listSwapsByUser
} from '@infra/database/repositories/swapRepository';
import {
  findTokenById,
  getUserBalance
} from '@infra/database/repositories/tokenRepository';
import { insertAuditLog } from '@infra/database/repositories/tradingRepository';
import { swapEventPublisher } from '@lib/events/swapEventPublisher';
import {
  getSapphireTokenClient,
  initializeSapphireTokenClient
} from '@clients/sapphireTokenClient';
import { AppConfig } from '@config';
import { TokenService } from './tokenService';
import { Token } from '@app-types/token';

export class SwapService {
  constructor(
    private readonly swapQueue: Queue<SwapJobPayload>,
    private readonly tokenService: TokenService
  ) {
    initializeSapphireTokenClient();
  }

  async generateQuote(params: {
    sourceTokenId: string;
    targetTokenId: string;
    sourceAmount: string;
  }): Promise<SwapQuote> {
    const [sourceToken, targetToken] = await Promise.all([
      findTokenById(params.sourceTokenId),
      findTokenById(params.targetTokenId)
    ]);

    if (!sourceToken || !targetToken) {
      throw new ApplicationError('Source or target token not found', {
        statusCode: 404,
        code: 'swap_token_not_found'
      });
    }

    return this.buildQuote(sourceToken, targetToken, params.sourceAmount);
  }

  async requestSwap(input: CreateSwapInput): Promise<SwapRecord> {
    this.validateSwapInput(input);

    const [sourceToken, targetToken] = await Promise.all([
      findTokenById(input.sourceTokenId),
      findTokenById(input.targetTokenId)
    ]);

    if (!sourceToken || !targetToken) {
      throw new ApplicationError('Source or target token not found', {
        statusCode: 404,
        code: 'swap_token_not_found'
      });
    }

    if (!sourceToken.contractAddress || !targetToken.contractAddress) {
      throw new ApplicationError('Token contract address missing', {
        statusCode: 400,
        code: 'token_contract_missing'
      });
    }

    await this.ensureComplianceIfRequired(input.userId, sourceToken.id);
    await this.ensureComplianceIfRequired(input.userId, targetToken.id);

    await this.ensureSufficientBalance(input.userId, sourceToken.id, input.sourceAmount);

    await this.tokenService.lockBalanceForOrder(
      input.userId,
      sourceToken.id,
      input.sourceAmount
    );

    const quote =
      input.quote || (await this.buildQuote(sourceToken, targetToken, input.sourceAmount));

    const swap = await createSwapRequest({
      ...input,
      quote,
      metadata: {
        ...input.metadata,
        quote
      }
    });

    await this.swapQueue.add('process-token-swap', {
      swapId: swap.id,
      userId: input.userId,
      sourceTokenId: sourceToken.id,
      targetTokenId: targetToken.id,
      sourceChain: input.sourceChain,
      targetChain: input.targetChain,
      sourceAmount: input.sourceAmount,
      minTargetAmount: input.minTargetAmount,
      destinationAddress: input.destinationAddress,
      bridgeContractAddress: input.bridgeContractAddress,
      metadata: swap.metadata
    });

    const queuedSwap = await updateSwapStatus(swap.id, 'QUEUED');

    await insertAuditLog({
      userId: input.userId,
      action: 'SWAP_REQUEST_CREATED',
      resourceType: 'token_swap',
      resourceId: swap.id,
      details: {
        sourceTokenId: sourceToken.id,
        targetTokenId: targetToken.id,
        sourceAmount: input.sourceAmount,
        targetChain: input.targetChain,
        destinationAddress: input.destinationAddress
      }
    });

    await swapEventPublisher.publishRequested({
      swapId: swap.id,
      userId: input.userId,
      sourceTokenId: sourceToken.id,
      targetTokenId: targetToken.id,
      sourceChain: input.sourceChain,
      targetChain: input.targetChain,
      payload: {
        sourceAmount: input.sourceAmount,
        expectedTargetAmount: quote.expectedTargetAmount,
        destinationAddress: input.destinationAddress
      },
      status: 'QUEUED'
    });

    return queuedSwap;
  }

  async processSwapJob(job: Job<SwapJobPayload>): Promise<void> {
    const { swapId } = job.data;
    const swap = await findSwapById(swapId);

    if (!swap) {
      logger.error({ swapId }, 'Swap not found; cancelling job');
      return;
    }

    if (!['PENDING', 'QUEUED', 'PROCESSING'].includes(swap.status)) {
      logger.warn(
        { swapId, status: swap.status },
        'Swap in terminal state; skipping processing'
      );
      return;
    }

    const sourceToken = await findTokenById(swap.sourceTokenId);
    const targetToken = await findTokenById(swap.targetTokenId);

    if (!sourceToken || !targetToken) {
      await this.failSwap(
        swap.id,
        'Source or target token no longer available',
        SwapFailureHandling.UnlockSourceBalance
      );
      return;
    }

    if (!sourceToken.contractAddress || !targetToken.contractAddress) {
      await this.failSwap(
        swap.id,
        'Missing token contract address',
        SwapFailureHandling.UnlockSourceBalance
      );
      return;
    }

    const signerKey = AppConfig.sapphire.privateKey;
    if (!signerKey) {
      await this.failSwap(
        swap.id,
        'Missing Sapphire signer private key configuration',
        SwapFailureHandling.UnlockSourceBalance
      );
      return;
    }

    const sapphireClient = getSapphireTokenClient();

    await markSwapProcessing(swap.id, null, null);

    await swapEventPublisher.publishProcessing({
      swapId: swap.id,
      userId: swap.userId,
      sourceTokenId: swap.sourceTokenId,
      targetTokenId: swap.targetTokenId,
      sourceChain: swap.sourceChain,
      targetChain: swap.targetChain,
      payload: {
        sourceAmount: swap.sourceAmount,
        bridgeContractAddress: swap.bridgeContractAddress
      },
      status: 'PROCESSING'
    });

    try {
      const { swapId: sapphireSwapId, txHash } = await sapphireClient.swapTokens({
        sourceTokenAddress: sourceToken.contractAddress,
        targetTokenAddress: targetToken.contractAddress,
        amount: swap.sourceAmount,
        recipient: swap.destinationAddress,
        bridgeContractAddress: swap.bridgeContractAddress,
        targetChainId: swap.targetChain,
        signerPrivateKey: signerKey,
        minTargetAmount: job.data.minTargetAmount
      });

      await markSwapProcessing(swap.id, sapphireSwapId, txHash);

      await this.settleBalances(
        swap.userId,
        swap.sourceTokenId,
        swap.targetTokenId,
        swap.sourceAmount,
        swap.expectedTargetAmount
      );

      const completed = await markSwapCompleted(
        swap.id,
        txHash,
        swap.expectedTargetAmount
      );

      await insertAuditLog({
        userId: swap.userId,
        action: 'SWAP_COMPLETED',
        resourceType: 'token_swap',
        resourceId: swap.id,
        details: {
          sourceTokenId: swap.sourceTokenId,
          targetTokenId: swap.targetTokenId,
          sourceAmount: swap.sourceAmount,
          targetAmount: swap.expectedTargetAmount,
          sapphireSwapId,
          txHash
        }
      });

      await swapEventPublisher.publishCompleted({
        swapId: swap.id,
        userId: swap.userId,
        sourceTokenId: swap.sourceTokenId,
        targetTokenId: swap.targetTokenId,
        sourceChain: swap.sourceChain,
        targetChain: swap.targetChain,
        payload: {
          sourceAmount: swap.sourceAmount,
          targetAmount: completed.expectedTargetAmount,
          sapphireSwapId,
          txHash
        },
        status: 'COMPLETED'
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error({ error, swapId: swap.id }, 'Swap processing failed');

      const attemptsMade = job.attemptsMade ?? 0;
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = attemptsMade + 1 >= maxAttempts;

      if (isFinalAttempt) {
        await this.failSwap(
          swap.id,
          reason,
          SwapFailureHandling.UnlockSourceBalance
        );
      } else {
        await updateSwapStatus(swap.id, 'QUEUED' as SwapStatus);
        await swapEventPublisher.publishQueued({
          swapId: swap.id,
          userId: swap.userId,
          sourceTokenId: swap.sourceTokenId,
          targetTokenId: swap.targetTokenId,
          sourceChain: swap.sourceChain,
          targetChain: swap.targetChain,
          payload: {
            retryIn: job.opts.backoff ?? AppConfig.queues.retryBackoffMs,
            sourceAmount: swap.sourceAmount
          },
          status: 'QUEUED'
        });
      }

      throw error;
    }
  }

  async getSwapById(swapId: string): Promise<SwapRecord | null> {
    return findSwapById(swapId);
  }

  async listUserSwaps(userId: string, limit = 50): Promise<SwapRecord[]> {
    return listSwapsByUser(userId, limit);
  }

  private async buildQuote(
    sourceToken: Token,
    targetToken: Token,
    sourceAmount: string
  ): Promise<SwapQuote> {
    let amount: bigint;
    try {
      amount = BigInt(sourceAmount);
    } catch (error) {
      throw new ApplicationError('Invalid source amount for quote', {
        statusCode: 400,
        code: 'swap_invalid_amount',
        details: { sourceAmount }
      });
    }

    if (amount <= BigInt(0)) {
      throw new ApplicationError('Source amount must be positive', {
        statusCode: 400,
        code: 'swap_invalid_amount',
        details: { sourceAmount }
      });
    }

    const feeDivider = BigInt(10_000);
    const platformFeeBps = BigInt(25); // 0.25%
    const bridgeFeeBps = BigInt(15); // 0.15%
    const platformFee = (amount * platformFeeBps) / feeDivider;
    const bridgeFee = (amount * bridgeFeeBps) / feeDivider;
    const networkFee = BigInt(1000); // Flat fee in smallest units
    const totalFee = platformFee + bridgeFee + networkFee;

    if (totalFee >= amount) {
      throw new ApplicationError('Swap amount too low after fees', {
        statusCode: 400,
        code: 'swap_amount_below_fees',
        details: { sourceAmount }
      });
    }

    const netSourceAmount = amount - totalFee;
    const expectedTargetAmount = this.convertAmount(
      netSourceAmount,
      sourceToken.decimals,
      targetToken.decimals
    );

    return {
      sourceTokenId: sourceToken.id,
      targetTokenId: targetToken.id,
      sourceAmount,
      expectedTargetAmount,
      rate: this.estimateRate(sourceToken, targetToken),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      fees: {
        platformFee: platformFee.toString(),
        bridgeFee: bridgeFee.toString(),
        networkFee: networkFee.toString(),
        totalFee: totalFee.toString()
      }
    };
  }

  private async ensureComplianceIfRequired(userId: string, tokenId: string): Promise<void> {
    try {
      await this.tokenService.verifyCompliance(userId, tokenId);
    } catch (error) {
      logger.debug({ userId, tokenId }, 'Compliance verification skipped or failed');
    }
  }

  private async ensureSufficientBalance(
    userId: string,
    tokenId: string,
    amount: string
  ): Promise<void> {
    const balance = await this.tokenService.getUserBalance(userId, tokenId);
    if (!balance || BigInt(balance.availableBalance) < BigInt(amount)) {
      throw new ApplicationError('Insufficient balance for swap', {
        statusCode: 400,
        code: 'swap_insufficient_balance',
        details: {
          available: balance?.availableBalance ?? '0',
          required: amount
        }
      });
    }
  }

  private validateSwapInput(input: CreateSwapInput): void {
    if (input.sourceTokenId === input.targetTokenId) {
      throw new ApplicationError('Source and target tokens must differ', {
        statusCode: 400,
        code: 'swap_identical_tokens'
      });
    }

    try {
      if (BigInt(input.sourceAmount) <= BigInt(0)) {
        throw new Error('Amount must be positive');
      }
      if (input.minTargetAmount && BigInt(input.minTargetAmount) <= BigInt(0)) {
        throw new Error('Min target amount must be positive');
      }
    } catch (error) {
      throw new ApplicationError('Invalid numeric amount supplied for swap', {
        statusCode: 400,
        code: 'swap_invalid_amount',
        details: {
          sourceAmount: input.sourceAmount,
          minTargetAmount: input.minTargetAmount
        }
      });
    }
  }

  private async settleBalances(
    userId: string,
    sourceTokenId: string,
    targetTokenId: string,
    sourceAmount: string,
    targetAmount: string
  ): Promise<void> {
    const sourceBalance = await getUserBalance(userId, sourceTokenId);
    if (sourceBalance) {
      const locked = BigInt(sourceBalance.lockedBalance);
      const newLocked = (locked - BigInt(sourceAmount)).toString();
      await this.tokenService.updateBalanceInternal(
        userId,
        sourceTokenId,
        sourceBalance.availableBalance,
        newLocked
      );
    }

    const targetBalance = await getUserBalance(userId, targetTokenId);
    const available = BigInt(targetBalance?.availableBalance ?? '0') + BigInt(targetAmount);
    const lockedTarget = targetBalance ? targetBalance.lockedBalance : '0';

    await this.tokenService.updateBalanceInternal(
      userId,
      targetTokenId,
      available.toString(),
      lockedTarget
    );
  }

  private async failSwap(
    swapId: string,
    reason: string,
    handling: SwapFailureHandling
  ): Promise<void> {
    const swap = await markSwapFailed(swapId, reason);

    if (handling === SwapFailureHandling.UnlockSourceBalance) {
      try {
        await this.tokenService.unlockBalanceFromOrder(
          swap.userId,
          swap.sourceTokenId,
          swap.sourceAmount
        );
      } catch (unlockError) {
        logger.error(
          { unlockError, swapId },
          'Failed to unlock balance after swap failure'
        );
      }
    }

    await insertAuditLog({
      userId: swap.userId,
      action: 'SWAP_FAILED',
      resourceType: 'token_swap',
      resourceId: swap.id,
      details: {
        sourceTokenId: swap.sourceTokenId,
        targetTokenId: swap.targetTokenId,
        sourceAmount: swap.sourceAmount,
        failureReason: reason
      }
    });

    await swapEventPublisher.publishFailed({
      swapId: swap.id,
      userId: swap.userId,
      sourceTokenId: swap.sourceTokenId,
      targetTokenId: swap.targetTokenId,
      sourceChain: swap.sourceChain,
      targetChain: swap.targetChain,
      payload: {
        failureReason: reason
      },
      status: 'FAILED'
    });
  }

  private convertAmount(amount: bigint, sourceDecimals: number, targetDecimals: number): string {
    if (sourceDecimals === targetDecimals) {
      return amount.toString();
    }

    if (sourceDecimals > targetDecimals) {
      const diff = BigInt(sourceDecimals - targetDecimals);
      const divisor = BigInt(10) ** diff;
      return (amount / divisor).toString();
    }

    const diff = BigInt(targetDecimals - sourceDecimals);
    const multiplier = BigInt(10) ** diff;
    return (amount * multiplier).toString();
  }

  private estimateRate(sourceToken: Token, targetToken: Token): string {
    if (sourceToken.blockchain === targetToken.blockchain) {
      return '1.0000';
    }

    if (sourceToken.tokenType === 'STABLE' || targetToken.tokenType === 'STABLE') {
      return '0.9990';
    }

    return '1.0200';
  }
}

enum SwapFailureHandling {
  None,
  UnlockSourceBalance
}
