import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '@infra/redis';
import { entityPermissionsClient, AuthorizationRequest } from '@clients/entityPermissionsClient';
import { ApplicationError } from '@lib/errors';
import { logger } from '@infra/logging/logger';

const AUTH_CACHE_PREFIX = 'auth:';
const AUTH_CACHE_TTL = 300; // 5 minutes

/**
 * Authorization cache service
 * Caches Entity Permissions Core authorization decisions in Redis
 */
export class AuthorizationCache {
  /**
   * Get cached authorization decision
   */
  async getCachedAuthorization(request: AuthorizationRequest): Promise<boolean | null> {
    const redis = getRedisClient();
    const key = this.buildCacheKey(request);

    try {
      const cached = await redis.get(key);
      if (cached !== null) {
        logger.debug({ key }, 'Authorization cache hit');
        return cached === 'true';
      }
      return null;
    } catch (error) {
      logger.warn({ error }, 'Failed to get cached authorization');
      return null;
    }
  }

  /**
   * Cache authorization decision
   */
  async cacheAuthorization(request: AuthorizationRequest, allowed: boolean): Promise<void> {
    const redis = getRedisClient();
    const key = this.buildCacheKey(request);

    try {
      await redis.setex(key, AUTH_CACHE_TTL, allowed ? 'true' : 'false');
      logger.debug({ key, allowed }, 'Authorization cached');
    } catch (error) {
      logger.warn({ error }, 'Failed to cache authorization');
    }
  }

  /**
   * Invalidate cached authorization for a principal
   */
  async invalidateForPrincipal(principalId: string): Promise<void> {
    const redis = getRedisClient();
    const pattern = `${AUTH_CACHE_PREFIX}${principalId}:*`;

    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug({ principalId, count: keys.length }, 'Authorization cache invalidated');
      }
    } catch (error) {
      logger.warn({ error, principalId }, 'Failed to invalidate authorization cache');
    }
  }

  /**
   * Invalidate cached authorization for an entity
   */
  async invalidateForEntity(entityId: string): Promise<void> {
    const redis = getRedisClient();
    const pattern = `${AUTH_CACHE_PREFIX}*:${entityId}:*`;

    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug({ entityId, count: keys.length }, 'Authorization cache invalidated');
      }
    } catch (error) {
      logger.warn({ error, entityId }, 'Failed to invalidate authorization cache');
    }
  }

  /**
   * Build cache key from authorization request
   */
  private buildCacheKey(request: AuthorizationRequest): string {
    const contextHash = request.context
      ? JSON.stringify(request.context)
      : 'no-context';

    return `${AUTH_CACHE_PREFIX}${request.principalId}:${request.entityId}:${request.action}:${contextHash}`;
  }
}

export const authorizationCache = new AuthorizationCache();

/**
 * Middleware to check authorization with caching
 */
export const checkAuthorization = (action: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.body.userId || req.params.userId;
      const entityId = req.body.tradingPairId || req.params.pairId || req.body.marketId;

      if (!userId || !entityId) {
        throw new ApplicationError('Missing userId or entityId for authorization', {
          statusCode: 400,
          code: 'missing_auth_params'
        });
      }

      const authRequest: AuthorizationRequest = {
        principalId: userId,
        entityId,
        action,
        context: {
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      };

      let allowed = await authorizationCache.getCachedAuthorization(authRequest);

      if (allowed === null) {
        const authResponse = await entityPermissionsClient.authorize(authRequest);
        allowed = authResponse.allowed;

        await authorizationCache.cacheAuthorization(authRequest, allowed);

        logger.info(
          {
            userId,
            entityId,
            action,
            allowed,
            reasons: authResponse.reasons
          },
          'Authorization checked'
        );
      } else {
        logger.debug(
          { userId, entityId, action, allowed },
          'Authorization from cache'
        );
      }

      if (!allowed) {
        throw new ApplicationError('Unauthorized', {
          statusCode: 403,
          code: 'unauthorized'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
