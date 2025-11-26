import { getRedisClient } from '@infra/redis';
import { logger } from '@infra/logging/logger';

export class CacheManager {
  private prefix: string;

  constructor(prefix: string = 'cache') {
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = getRedisClient();
      const data = await redis.get(this.getKey(key));
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ error, key }, 'Cache get error');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setex(this.getKey(key), ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error({ error, key }, 'Cache set error');
    }
  }

  async del(key: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(this.getKey(key));
    } catch (error) {
      logger.error({ error, key }, 'Cache delete error');
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const keys = await redis.keys(this.getKey(pattern));
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache delete pattern error');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const result = await redis.exists(this.getKey(key));
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Cache exists error');
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      const redis = getRedisClient();
      return await redis.ttl(this.getKey(key));
    } catch (error) {
      logger.error({ error, key }, 'Cache TTL error');
      return -1;
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const redis = getRedisClient();
      const redisKeys = keys.map(k => this.getKey(k));
      const values = await redis.mget(...redisKeys);
      return values.map(v => (v ? JSON.parse(v) : null));
    } catch (error) {
      logger.error({ error, keys }, 'Cache mget error');
      return keys.map(() => null);
    }
  }

  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    try {
      const redis = getRedisClient();
      const pipeline = redis.pipeline();

      for (const entry of entries) {
        const ttl = entry.ttl || 300;
        pipeline.setex(this.getKey(entry.key), ttl, JSON.stringify(entry.value));
      }

      await pipeline.exec();
    } catch (error) {
      logger.error({ error }, 'Cache mset error');
    }
  }

  async incr(key: string, amount: number = 1): Promise<number> {
    try {
      const redis = getRedisClient();
      return await redis.incrby(this.getKey(key), amount);
    } catch (error) {
      logger.error({ error, key }, 'Cache incr error');
      return 0;
    }
  }

  async decr(key: string, amount: number = 1): Promise<number> {
    try {
      const redis = getRedisClient();
      return await redis.decrby(this.getKey(key), amount);
    } catch (error) {
      logger.error({ error, key }, 'Cache decr error');
      return 0;
    }
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.zadd(this.getKey(key), score, member);
    } catch (error) {
      logger.error({ error, key }, 'Cache zadd error');
    }
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const redis = getRedisClient();
      return await redis.zrange(this.getKey(key), start, stop);
    } catch (error) {
      logger.error({ error, key }, 'Cache zrange error');
      return [];
    }
  }

  async zrem(key: string, member: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.zrem(this.getKey(key), member);
    } catch (error) {
      logger.error({ error, key }, 'Cache zrem error');
    }
  }

  async lpush(key: string, value: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.lpush(this.getKey(key), value);
    } catch (error) {
      logger.error({ error, key }, 'Cache lpush error');
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      const redis = getRedisClient();
      return await redis.lrange(this.getKey(key), start, stop);
    } catch (error) {
      logger.error({ error, key }, 'Cache lrange error');
      return [];
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.ltrim(this.getKey(key), start, stop);
    } catch (error) {
      logger.error({ error, key }, 'Cache ltrim error');
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.expire(this.getKey(key), ttlSeconds);
    } catch (error) {
      logger.error({ error, key }, 'Cache expire error');
    }
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.sadd(this.getKey(key), ...members);
    } catch (error) {
      logger.error({ error, key }, 'Cache sadd error');
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      const redis = getRedisClient();
      return await redis.smembers(this.getKey(key));
    } catch (error) {
      logger.error({ error, key }, 'Cache smembers error');
      return [];
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const result = await redis.sismember(this.getKey(key), member);
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Cache sismember error');
      return false;
    }
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.srem(this.getKey(key), ...members);
    } catch (error) {
      logger.error({ error, key }, 'Cache srem error');
    }
  }
}

export const marketCache = new CacheManager('market');
export const tokenCache = new CacheManager('token');
export const tradingCache = new CacheManager('trading');
export const userCache = new CacheManager('user');
