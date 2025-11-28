import { initializeDatabase, shutdownDatabase } from '@infra/database';
import { initializeRedis, shutdownRedis } from '@infra/redis';
import { initializeQueues, shutdownQueues } from '@infra/queue';
import { initializeSapphire, shutdownSapphire } from '@infra/sapphire/provider';
import { initializeEventListeners, shutdownEventListeners } from '@infra/events';
import { logger } from '@infra/logging/logger';
import { startTransactionManager, stopTransactionManager } from '@services/transactionManagerSingleton';
import { initializeTokenDeploymentWorker } from '@infra/queue/tokenDeploymentHandler';

export const bootstrapInfrastructure = async (): Promise<void> => {
  logger.info('Bootstrapping infrastructure components');
  await initializeDatabase();
  await initializeRedis();
  await initializeQueues();
  await initializeSapphire();
  await initializeEventListeners();
  await startTransactionManager();
  initializeTokenDeploymentWorker();
};

export const shutdownInfrastructure = async (): Promise<void> => {
  logger.info('Shutting down infrastructure components');
  await shutdownEventListeners();
  await stopTransactionManager();
  await shutdownSapphire();
  await shutdownQueues();
  await shutdownRedis();
  await shutdownDatabase();
};
