import { getRedisClient } from '@infra/redis';
import { ApplicationError } from '@lib/errors';
import { logger } from '@infra/logging/logger';

const NONCE_PREFIX = 'nonce:';
const NONCE_TTL = 3600; // 1 hour

/**
 * Redis-backed nonce service for replay protection
 */
export class NonceService {
  /**
   * Check if nonce has been used for a given user address
   */
  async isNonceUsed(userAddress: string, nonce: string): Promise<boolean> {
    const redis = getRedisClient();
    const key = `${NONCE_PREFIX}${userAddress}:${nonce}`;
    const exists = await redis.exists(key);
    return exists === 1;
  }

  /**
   * Mark nonce as used (with TTL for cleanup)
   */
  async markNonceAsUsed(userAddress: string, nonce: string): Promise<void> {
    const redis = getRedisClient();
    const key = `${NONCE_PREFIX}${userAddress}:${nonce}`;

    const wasSet = await redis.set(key, '1', 'EX', NONCE_TTL, 'NX');

    if (!wasSet) {
      throw new ApplicationError('Nonce already used', {
        statusCode: 400,
        code: 'nonce_reused',
        details: { userAddress, nonce }
      });
    }

    logger.debug({ userAddress, nonce }, 'Nonce marked as used');
  }

  /**
   * Validate and consume nonce
   */
  async validateAndConsumeNonce(userAddress: string, nonce: string): Promise<void> {
    const isUsed = await this.isNonceUsed(userAddress, nonce);

    if (isUsed) {
      throw new ApplicationError('Nonce already used', {
        statusCode: 400,
        code: 'nonce_reused',
        details: { userAddress, nonce }
      });
    }

    await this.markNonceAsUsed(userAddress, nonce);
  }

  /**
   * Get next available nonce for user (for client convenience)
   */
  async getNextNonce(userAddress: string): Promise<string> {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

export const nonceService = new NonceService();
