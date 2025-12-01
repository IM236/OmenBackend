import Redis, { RedisOptions } from 'ioredis';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';

let redisClient: Redis | null = null;

export const initializeRedis = async (): Promise<void> => {
  if (redisClient) {
    return;
  }

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true
  };

  if (AppConfig.redis.password) {
    options.password = AppConfig.redis.password;
  }

  if (AppConfig.redis.tls) {
    options.tls = {};
  }

  redisClient = new Redis(AppConfig.redis.url, options);

  redisClient.on('error', (error) => {
    logger.error(error, 'Redis connection error');
  });

  redisClient.on('ready', () => {
    logger.info('Redis connection established');
  });

  await redisClient.connect();
};

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    throw new Error('Redis client not initialised. Call initializeRedis first.');
  }

  return redisClient;
};

export const shutdownRedis = async (): Promise<void> => {
  if (!redisClient) {
    return;
  }

  await redisClient.quit();
  redisClient = null;
  logger.info('Redis connection closed');
};

export type RedisClient = Redis;
