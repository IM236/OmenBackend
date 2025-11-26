import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import {
  Token,
  UserBalance,
  ComplianceRecord,
  MintTokenInput,
  TransferTokenInput,
  CreateTokenInput
} from '@types/token';
import {
  createToken,
  findTokenById,
  findTokenBySymbol,
  listActiveTokens,
  getUserBalance,
  getUserBalances,
  updateBalance,
  lockBalance,
  unlockBalance,
  getComplianceRecord,
  upsertComplianceRecord
} from '@infra/database/repositories/tokenRepository';
import { getRedisClient } from '@infra/redis';
import { Queue } from 'bullmq';

export class TokenService {
  constructor(
    private readonly mintQueue: Queue,
    private readonly transferQueue: Queue,
    private readonly blockchainSyncQueue: Queue,
    private readonly complianceQueue: Queue
  ) {}

  async createToken(input: CreateTokenInput): Promise<Token> {
    const existing = await findTokenBySymbol(input.tokenSymbol);
    if (existing) {
      throw new ApplicationError('Token symbol already exists', {
        statusCode: 409,
        code: 'token_exists'
      });
    }

    const token = await createToken(input);

    await this.cacheToken(token);

    logger.info({ tokenId: token.id, symbol: token.tokenSymbol }, 'Token created');
    return token;
  }

  async getToken(tokenId: string): Promise<Token | null> {
    const cached = await this.getCachedToken(tokenId);
    if (cached) {
      return cached;
    }

    const token = await findTokenById(tokenId);
    if (token) {
      await this.cacheToken(token);
    }
    return token;
  }

  async getTokenBySymbol(symbol: string): Promise<Token | null> {
    const token = await findTokenBySymbol(symbol);
    if (token) {
      await this.cacheToken(token);
    }
    return token;
  }

  async listTokens(): Promise<Token[]> {
    return listActiveTokens();
  }

  async mintToken(input: MintTokenInput): Promise<void> {
    const token = await findTokenById(input.tokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    if (token.tokenType === 'RWA') {
      await this.verifyCompliance(input.userId, input.tokenId);
    }

    await this.mintQueue.add('mint-token', {
      tokenId: input.tokenId,
      userId: input.userId,
      amount: input.amount,
      metadata: input.metadata || {}
    });

    logger.info(
      { tokenId: input.tokenId, userId: input.userId, amount: input.amount },
      'Mint job enqueued'
    );
  }

  async processTransfer(input: TransferTokenInput): Promise<void> {
    const token = await findTokenById(input.tokenId);
    if (!token) {
      throw new ApplicationError('Token not found', {
        statusCode: 404,
        code: 'token_not_found'
      });
    }

    const fromBalance = await getUserBalance(input.fromUserId, input.tokenId);
    if (!fromBalance || BigInt(fromBalance.availableBalance) < BigInt(input.amount)) {
      throw new ApplicationError('Insufficient balance', {
        statusCode: 400,
        code: 'insufficient_balance'
      });
    }

    if (token.tokenType === 'RWA') {
      await this.verifyCompliance(input.fromUserId, input.tokenId);
      await this.verifyCompliance(input.toUserId, input.tokenId);
    }

    await this.transferQueue.add('process-transfer', {
      tokenId: input.tokenId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: input.amount,
      metadata: input.metadata || {}
    });

    logger.info(
      {
        tokenId: input.tokenId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount
      },
      'Transfer job enqueued'
    );
  }

  async getUserBalance(userId: string, tokenId: string): Promise<UserBalance | null> {
    const cached = await this.getCachedBalance(userId, tokenId);
    if (cached) {
      return cached;
    }

    const balance = await getUserBalance(userId, tokenId);
    if (balance) {
      await this.cacheBalance(balance);
    }
    return balance;
  }

  async getUserBalances(userId: string): Promise<UserBalance[]> {
    return getUserBalances(userId);
  }

  async updateBalanceInternal(
    userId: string,
    tokenId: string,
    availableBalance: string,
    lockedBalance: string
  ): Promise<UserBalance> {
    const balance = await updateBalance(userId, tokenId, availableBalance, lockedBalance);
    await this.cacheBalance(balance);
    await this.invalidateUserSessionCache(userId);
    return balance;
  }

  async lockBalanceForOrder(userId: string, tokenId: string, amount: string): Promise<UserBalance> {
    const balance = await lockBalance(userId, tokenId, amount);
    await this.cacheBalance(balance);
    await this.invalidateUserSessionCache(userId);
    return balance;
  }

  async unlockBalanceFromOrder(userId: string, tokenId: string, amount: string): Promise<UserBalance> {
    const balance = await unlockBalance(userId, tokenId, amount);
    await this.cacheBalance(balance);
    await this.invalidateUserSessionCache(userId);
    return balance;
  }

  async verifyCompliance(userId: string, tokenId: string): Promise<void> {
    const compliance = await getComplianceRecord(userId, tokenId);

    if (!compliance || compliance.kycStatus !== 'APPROVED') {
      throw new ApplicationError('KYC verification required', {
        statusCode: 403,
        code: 'kyc_required'
      });
    }

    if (!compliance.whitelistStatus) {
      throw new ApplicationError('User not whitelisted for this token', {
        statusCode: 403,
        code: 'not_whitelisted'
      });
    }

    if (compliance.expiryDate && new Date() > compliance.expiryDate) {
      throw new ApplicationError('Compliance status expired', {
        statusCode: 403,
        code: 'compliance_expired'
      });
    }
  }

  async updateCompliance(
    userId: string,
    tokenId: string | null,
    data: Parameters<typeof upsertComplianceRecord>[2]
  ): Promise<ComplianceRecord> {
    return upsertComplianceRecord(userId, tokenId, data);
  }

  private async cacheToken(token: Token): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `token:metadata:${token.id}`,
      3600,
      JSON.stringify(token)
    );
  }

  private async getCachedToken(tokenId: string): Promise<Token | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`token:metadata:${tokenId}`);
    return cached ? JSON.parse(cached) : null;
  }

  private async cacheBalance(balance: UserBalance): Promise<void> {
    const redis = getRedisClient();
    await redis.setex(
      `token:balance:${balance.userId}:${balance.tokenId}`,
      300,
      JSON.stringify(balance)
    );
  }

  private async getCachedBalance(userId: string, tokenId: string): Promise<UserBalance | null> {
    const redis = getRedisClient();
    const cached = await redis.get(`token:balance:${userId}:${tokenId}`);
    return cached ? JSON.parse(cached) : null;
  }

  private async invalidateUserSessionCache(userId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(`user:session:${userId}`);
  }
}
