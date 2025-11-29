import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';
import { getRedisClient } from '@infra/redis';

let transactionQueue: Queue | null = null;
let deadLetterQueue: Queue | null = null;
let transactionWorker: Worker | null = null;

let mintTokenQueue: Queue | null = null;
let transferQueue: Queue | null = null;
let blockchainSyncQueue: Queue | null = null;
let complianceQueue: Queue | null = null;
let settlementQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let analyticsQueue: Queue | null = null;
let externalPriceQueue: Queue | null = null;
let candleAggregationQueue: Queue | null = null;
let metadataUpdateQueue: Queue | null = null;
let withdrawalQueue: Queue | null = null;
let tokenDeploymentQueue: Queue | null = null;
let reconciliationQueue: Queue | null = null;
let matchingQueue: Queue | null = null;
let swapQueue: Queue | null = null;

const workers: Worker[] = [];

export const createQueueConnection = (): Redis => {
  const baseClient = getRedisClient();
  return new Redis(baseClient.options);
};

export const initializeQueues = async (): Promise<void> => {
  if (transactionQueue) {
    return;
  }

  const defaultOptions = {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: AppConfig.queues.maxRetryAttempts,
    backoff: {
      type: 'exponential' as const,
      delay: AppConfig.queues.retryBackoffMs
    }
  };

  transactionQueue = new Queue(AppConfig.queues.transactionQueue, {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  deadLetterQueue = new Queue(AppConfig.queues.deadLetterQueue, {
    connection: createQueueConnection()
  });

  mintTokenQueue = new Queue('mint-token', {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  transferQueue = new Queue('process-transfer', {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  blockchainSyncQueue = new Queue('sync-blockchain', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 5 }
  });

  complianceQueue = new Queue('verify-compliance', {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  settlementQueue = new Queue('execute-blockchain-settlement', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 5 }
  });

  notificationQueue = new Queue('send-trade-notification', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 3 }
  });

  analyticsQueue = new Queue('update-market-stats', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 3 }
  });

  externalPriceQueue = new Queue('fetch-external-prices', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 3 }
  });

  candleAggregationQueue = new Queue('aggregate-candles', {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  metadataUpdateQueue = new Queue('update-token-metadata', {
    connection: createQueueConnection(),
    defaultJobOptions: defaultOptions
  });

  withdrawalQueue = new Queue('process-withdrawal', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 5 }
  });

  tokenDeploymentQueue = new Queue('deploy-token', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 5 }
  });

  reconciliationQueue = new Queue('blockchain-reconciliation', {
    connection: createQueueConnection(),
    defaultJobOptions: { ...defaultOptions, attempts: 3 }
  });

  matchingQueue = new Queue('order-matching', {
    connection: createQueueConnection(),
    defaultJobOptions: {
      ...defaultOptions,
      attempts: 5,
      removeOnComplete: {
        count: 1000, // Keep last 1000 successful matches for debugging
        age: 3600 // Remove after 1 hour
      },
      removeOnFail: false
    }
  });

  swapQueue = new Queue('process-token-swap', {
    connection: createQueueConnection(),
    defaultJobOptions: {
      ...defaultOptions,
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: AppConfig.queues.retryBackoffMs
      }
    }
  });

  logger.info('All BullMQ queues initialized');
};

export const registerTransactionWorker = (worker: Worker): void => {
  transactionWorker = worker;
};

export const registerWorker = (worker: Worker): void => {
  workers.push(worker);
};

export const getTransactionQueue = (): Queue => {
  if (!transactionQueue) {
    throw new Error('Transaction queue not initialised.');
  }
  return transactionQueue;
};

export const getDeadLetterQueue = (): Queue => {
  if (!deadLetterQueue) {
    throw new Error('Dead-letter queue not initialised.');
  }
  return deadLetterQueue;
};

export const getMintTokenQueue = (): Queue => {
  if (!mintTokenQueue) {
    throw new Error('Mint token queue not initialised.');
  }
  return mintTokenQueue;
};

export const getTransferQueue = (): Queue => {
  if (!transferQueue) {
    throw new Error('Transfer queue not initialised.');
  }
  return transferQueue;
};

export const getBlockchainSyncQueue = (): Queue => {
  if (!blockchainSyncQueue) {
    throw new Error('Blockchain sync queue not initialised.');
  }
  return blockchainSyncQueue;
};

export const getComplianceQueue = (): Queue => {
  if (!complianceQueue) {
    throw new Error('Compliance queue not initialised.');
  }
  return complianceQueue;
};

export const getSettlementQueue = (): Queue => {
  if (!settlementQueue) {
    throw new Error('Settlement queue not initialised.');
  }
  return settlementQueue;
};

export const getNotificationQueue = (): Queue => {
  if (!notificationQueue) {
    throw new Error('Notification queue not initialised.');
  }
  return notificationQueue;
};

export const getAnalyticsQueue = (): Queue => {
  if (!analyticsQueue) {
    throw new Error('Analytics queue not initialised.');
  }
  return analyticsQueue;
};

export const getExternalPriceQueue = (): Queue => {
  if (!externalPriceQueue) {
    throw new Error('External price queue not initialised.');
  }
  return externalPriceQueue;
};

export const getCandleAggregationQueue = (): Queue => {
  if (!candleAggregationQueue) {
    throw new Error('Candle aggregation queue not initialised.');
  }
  return candleAggregationQueue;
};

export const getMetadataUpdateQueue = (): Queue => {
  if (!metadataUpdateQueue) {
    throw new Error('Metadata update queue not initialised.');
  }
  return metadataUpdateQueue;
};

export const getWithdrawalQueue = (): Queue => {
  if (!withdrawalQueue) {
    throw new Error('Withdrawal queue not initialised.');
  }
  return withdrawalQueue;
};

export const getTokenDeploymentQueue = (): Queue => {
  if (!tokenDeploymentQueue) {
    throw new Error('Token deployment queue not initialised.');
  }
  return tokenDeploymentQueue;
};

export const getReconciliationQueue = (): Queue => {
  if (!reconciliationQueue) {
    throw new Error('Reconciliation queue not initialised.');
  }
  return reconciliationQueue;
};

export const getMatchingQueue = (): Queue => {
  if (!matchingQueue) {
    throw new Error('Matching queue not initialised.');
  }
  return matchingQueue;
};

export const getSwapQueue = (): Queue => {
  if (!swapQueue) {
    throw new Error('Swap queue not initialised.');
  }
  return swapQueue;
};

export const shutdownQueues = async (): Promise<void> => {
  const allQueues = [
    transactionQueue,
    deadLetterQueue,
    mintTokenQueue,
    transferQueue,
    blockchainSyncQueue,
    complianceQueue,
    settlementQueue,
    notificationQueue,
    analyticsQueue,
    externalPriceQueue,
    candleAggregationQueue,
    metadataUpdateQueue,
    withdrawalQueue,
    tokenDeploymentQueue,
    reconciliationQueue,
    matchingQueue,
    swapQueue
  ];

  const allWorkers = [transactionWorker, ...workers];

  await Promise.all([
    ...allWorkers.map(w => w?.close().catch((error) => {
      logger.error(error, 'Error closing worker');
    })),
    ...allQueues.map(q => q?.close().catch((error) => {
      logger.error(error, 'Error closing queue');
    }))
  ]);

  transactionWorker = null;
  transactionQueue = null;
  deadLetterQueue = null;
  mintTokenQueue = null;
  transferQueue = null;
  blockchainSyncQueue = null;
  complianceQueue = null;
  settlementQueue = null;
  notificationQueue = null;
  analyticsQueue = null;
  externalPriceQueue = null;
  candleAggregationQueue = null;
  metadataUpdateQueue = null;
  withdrawalQueue = null;
  tokenDeploymentQueue = null;
  reconciliationQueue = null;
  matchingQueue = null;
  swapQueue = null;
  workers.length = 0;
};
