import { Pool, PoolConfig } from 'pg';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';

let pool: Pool | null = null;

export const initializeDatabase = async (): Promise<void> => {
  if (pool) {
    return;
  }

  const config: PoolConfig = {
    connectionString: AppConfig.database.url,
    min: AppConfig.database.poolMin,
    max: AppConfig.database.poolMax,
    ssl: AppConfig.database.ssl
      ? {
          rejectUnauthorized: false
        }
      : undefined
  };

  pool = new Pool(config);

  pool.on('error', (error) => {
    logger.error(error, 'Unexpected PostgreSQL pool error');
  });

  // Eagerly test the connection so we fail fast when misconfigured.
  await pool.query('SELECT 1');
  logger.info('Database connection pool initialised');
};

export const getDatabasePool = (): Pool => {
  if (!pool) {
    throw new Error('Database pool not initialised. Call initializeDatabase first.');
  }

  return pool;
};

export const shutdownDatabase = async (): Promise<void> => {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
  logger.info('Database connection pool closed');
};

export type DbClient = Pool;
