import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import {
  WrapRequest,
  UnwrapRequest,
  WrapTransaction,
  UnwrapTransaction,
  WrapQuote,
  SapphireWrapResponse,
  SapphireUnwrapResponse
} from '@app-types/wrapper';
import { Token } from '@app-types/token';
import { findTokenById, getUserBalance, lockBalance, unlockBalance } from '@infra/database/repositories/tokenRepository';
import { getRedisClient } from '@infra/redis';
import { Queue } from 'bullmq';

/**
 * WrapperService - Handles wrapping tokenized assets into USDC via Sapphire
 *
 * This service provides functionality to:
 * 1. Wrap tokenized RWA assets into USDC
 * 2. Unwrap USDC back into tokenized assets
 * 3. Get wrap/unwrap quotes with exchange rates
 * 4. Track wrap/unwrap transaction status
 */
export class WrapperService {
  constructor(
    private readonly wrapQueue: Queue,
    private readonly unwrapQueue: Queue
  ) {}

  /**
   * Get a quote for wrapping tokens into USDC
   */
  async getWrapQuote(tokenId: string, tokenAmount: string): Promise<WrapQuote> {
    const token = await findTokenById(tokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    // Verify token is eligible for wrapping (RWA tokens only)
    if (token.tokenType !== 'RWA') {
      throw new ApplicationError('Only RWA tokens can be wrapped', {
        statusCode: 400,
        code: 'invalid_token_type',
        details: { tokenType: token.tokenType }
      });
    }

    // TODO: Call Sapphire service to get real-time exchange rate
    // For now, using mock calculation
    const exchangeRate = await this.getExchangeRate(tokenId);
    const usdcAmount = this.calculateUsdcAmount(tokenAmount, exchangeRate);
    const fees = this.calculateFees(usdcAmount);

    const quote: WrapQuote = {
      tokenId,
      tokenAmount,
      usdcAmount,
      exchangeRate,
      fees,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes expiry
    };

    // Cache the quote for validation during wrap execution
    await this.cacheQuote(quote);

    logger.info({ tokenId, tokenAmount, usdcAmount }, 'Wrap quote generated');
    return quote;
  }

  /**
   * Get a quote for unwrapping USDC back into tokens
   */
  async getUnwrapQuote(tokenId: string, usdcAmount: string): Promise<WrapQuote> {
    const token = await findTokenById(tokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    if (token.tokenType !== 'RWA') {
      throw new ApplicationError('Only RWA tokens can be unwrapped', {
        statusCode: 400,
        code: 'invalid_token_type',
        details: { tokenType: token.tokenType }
      });
    }

    // TODO: Call Sapphire service to get real-time exchange rate
    const exchangeRate = await this.getExchangeRate(tokenId);
    const tokenAmount = this.calculateTokenAmount(usdcAmount, exchangeRate);
    const fees = this.calculateFees(usdcAmount);

    const quote: WrapQuote = {
      tokenId,
      tokenAmount,
      usdcAmount,
      exchangeRate,
      fees,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    };

    await this.cacheQuote(quote);

    logger.info({ tokenId, usdcAmount, tokenAmount }, 'Unwrap quote generated');
    return quote;
  }

  /**
   * Wrap tokenized assets into USDC
   */
  async wrapAsset(request: WrapRequest): Promise<{ transactionId: string }> {
    // Validate token exists and is of correct type
    const token = await findTokenById(request.tokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    if (token.tokenType !== 'RWA') {
      throw new ApplicationError('Only RWA tokens can be wrapped', {
        statusCode: 400,
        code: 'invalid_token_type'
      });
    }

    // Check user has sufficient balance
    const balance = await getUserBalance(request.userId, request.tokenId);
    if (!balance || BigInt(balance.availableBalance) < BigInt(request.amount)) {
      throw new ApplicationError('Insufficient balance', {
        statusCode: 400,
        code: 'insufficient_balance',
        details: {
          available: balance?.availableBalance || '0',
          required: request.amount
        }
      });
    }

    // Lock the tokens being wrapped
    await lockBalance(request.userId, request.tokenId, request.amount);

    // Generate transaction ID
    const transactionId = this.generateTransactionId();

    // Enqueue wrap job for async processing
    await this.wrapQueue.add('wrap-asset', {
      transactionId,
      userId: request.userId,
      tokenId: request.tokenId,
      amount: request.amount,
      destinationAddress: request.destinationAddress,
      metadata: request.metadata || {}
    });

    logger.info(
      { transactionId, userId: request.userId, tokenId: request.tokenId, amount: request.amount },
      'Wrap job enqueued'
    );

    return { transactionId };
  }

  /**
   * Unwrap USDC back into tokenized assets
   */
  async unwrapAsset(request: UnwrapRequest): Promise<{ transactionId: string }> {
    // Validate target token exists and is of correct type
    const token = await findTokenById(request.targetTokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    if (token.tokenType !== 'RWA') {
      throw new ApplicationError('Only RWA tokens can be unwrapped to', {
        statusCode: 400,
        code: 'invalid_token_type'
      });
    }

    // Check user has sufficient USDC balance
    // Assuming USDC token exists in system with known ID
    const usdcToken = await this.getUsdcToken();
    const usdcBalance = await getUserBalance(request.userId, usdcToken.id);

    if (!usdcBalance || BigInt(usdcBalance.availableBalance) < BigInt(request.usdcAmount)) {
      throw new ApplicationError('Insufficient USDC balance', {
        statusCode: 400,
        code: 'insufficient_usdc_balance',
        details: {
          available: usdcBalance?.availableBalance || '0',
          required: request.usdcAmount
        }
      });
    }

    // Lock the USDC being unwrapped
    await lockBalance(request.userId, usdcToken.id, request.usdcAmount);

    // Generate transaction ID
    const transactionId = this.generateTransactionId();

    // Enqueue unwrap job for async processing
    await this.unwrapQueue.add('unwrap-asset', {
      transactionId,
      userId: request.userId,
      usdcAmount: request.usdcAmount,
      targetTokenId: request.targetTokenId,
      destinationAddress: request.destinationAddress,
      metadata: request.metadata || {}
    });

    logger.info(
      { transactionId, userId: request.userId, targetTokenId: request.targetTokenId, usdcAmount: request.usdcAmount },
      'Unwrap job enqueued'
    );

    return { transactionId };
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<WrapTransaction | UnwrapTransaction | null> {
    // Check cache first
    const cached = await this.getCachedTransaction(transactionId);
    if (cached) {
      return cached;
    }

    // TODO: Query from database
    // For now, return null - would normally query wrapTransactions or unwrapTransactions table
    logger.info({ transactionId }, 'Transaction not found in cache');
    return null;
  }

  /**
   * Call Sapphire service to execute wrap operation
   * This would be called by the queue worker
   */
  async executeSapphireWrap(
    tokenId: string,
    amount: string,
    destinationAddress?: string
  ): Promise<SapphireWrapResponse> {
    // TODO: Implement actual Sapphire API call
    // This is a placeholder that simulates the Sapphire service call

    logger.info(
      { tokenId, amount, destinationAddress },
      'Calling Sapphire wrap service (mock)'
    );

    // Mock response
    const exchangeRate = await this.getExchangeRate(tokenId);
    const usdcAmount = this.calculateUsdcAmount(amount, exchangeRate);

    return {
      transactionId: this.generateTransactionId(),
      status: 'PROCESSING',
      usdcAmount,
      exchangeRate,
      estimatedCompletionTime: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
  }

  /**
   * Call Sapphire service to execute unwrap operation
   * This would be called by the queue worker
   */
  async executeSapphireUnwrap(
    tokenId: string,
    usdcAmount: string,
    destinationAddress?: string
  ): Promise<SapphireUnwrapResponse> {
    // TODO: Implement actual Sapphire API call
    // This is a placeholder that simulates the Sapphire service call

    logger.info(
      { tokenId, usdcAmount, destinationAddress },
      'Calling Sapphire unwrap service (mock)'
    );

    // Mock response
    const exchangeRate = await this.getExchangeRate(tokenId);
    const tokenAmount = this.calculateTokenAmount(usdcAmount, exchangeRate);

    return {
      transactionId: this.generateTransactionId(),
      status: 'PROCESSING',
      tokenAmount,
      exchangeRate,
      estimatedCompletionTime: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
  }

  // Private helper methods

  private async getExchangeRate(tokenId: string): Promise<string> {
    // TODO: Get real exchange rate from Sapphire or price oracle
    // Mock: 1 token = 100 USDC
    return '100.00';
  }

  private calculateUsdcAmount(tokenAmount: string, exchangeRate: string): string {
    const amount = BigInt(tokenAmount);
    const rate = BigInt(Math.floor(parseFloat(exchangeRate) * 100));
    return ((amount * rate) / BigInt(100)).toString();
  }

  private calculateTokenAmount(usdcAmount: string, exchangeRate: string): string {
    const amount = BigInt(usdcAmount);
    const rate = BigInt(Math.floor(parseFloat(exchangeRate) * 100));
    return ((amount * BigInt(100)) / rate).toString();
  }

  private calculateFees(amount: string): WrapQuote['fees'] {
    const amountBigInt = BigInt(amount);
    // 0.5% platform fee
    const platformFee = (amountBigInt * BigInt(50)) / BigInt(10000);
    // Mock network fee
    const networkFee = BigInt(1000000); // 1 USDC in smallest unit
    const totalFee = platformFee + networkFee;

    return {
      platformFee: platformFee.toString(),
      networkFee: networkFee.toString(),
      totalFee: totalFee.toString()
    };
  }

  private generateTransactionId(): string {
    return `wrap_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private async getUsdcToken(): Promise<Token> {
    // TODO: Query USDC token from database
    // For now, throw error - this should be implemented based on your USDC token setup
    throw new ApplicationError('USDC token not configured', {
      statusCode: 500,
      code: 'usdc_not_configured'
    });
  }

  private async cacheQuote(quote: WrapQuote): Promise<void> {
    const redis = getRedisClient();
    const key = `wrap:quote:${quote.tokenId}:${quote.tokenAmount}`;
    await redis.setex(key, 300, JSON.stringify(quote)); // 5 minutes TTL
  }

  private async cacheTransaction(transaction: WrapTransaction | UnwrapTransaction): Promise<void> {
    const redis = getRedisClient();
    const key = `wrap:transaction:${transaction.id}`;
    await redis.setex(key, 3600, JSON.stringify(transaction)); // 1 hour TTL
  }

  private async getCachedTransaction(
    transactionId: string
  ): Promise<WrapTransaction | UnwrapTransaction | null> {
    const redis = getRedisClient();
    const key = `wrap:transaction:${transactionId}`;
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }
}
