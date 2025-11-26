import { Worker, Job } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { createQueueConnection } from './index';
import { AppConfig } from '@config';

export interface MintTokenJobData {
  tokenId: string;
  userId: string;
  amount: string;
  metadata: Record<string, unknown>;
}

export interface ProcessTransferJobData {
  tokenId: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
  metadata: Record<string, unknown>;
}

export interface BlockchainSyncJobData {
  blockchain: string;
  fromBlock: bigint;
  toBlock: bigint;
}

export interface ComplianceVerificationJobData {
  userId: string;
  tokenId: string;
  kycProvider: string;
}

export interface BlockchainSettlementJobData {
  tradeId: string;
  tradingPairId: string;
}

export interface TradeNotificationJobData {
  buyerId: string;
  sellerId: string;
  tradeId: string;
}

export interface AnalyticsUpdateJobData {
  tradingPairId: string;
  tradeId: string;
}

export interface ExternalPriceJobData {
  tradingPairId: string;
  pairSymbol: string;
}

export interface CandleAggregationJobData {
  tradingPairId: string;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
}

export interface TokenMetadataUpdateJobData {
  tokenId: string;
}

export interface WithdrawalProcessingJobData {
  withdrawalId: string;
}

export const createMintTokenWorker = (
  handler: (job: Job<MintTokenJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('mint-token', handler, {
    connection: createQueueConnection(),
    concurrency: AppConfig.queues.workerConcurrency || 5
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tokenId: job.data.tokenId }, 'Mint token job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tokenId: job?.data?.tokenId, error: err },
      'Mint token job failed'
    );
  });

  return worker;
};

export const createTransferWorker = (
  handler: (job: Job<ProcessTransferJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('process-transfer', handler, {
    connection: createQueueConnection(),
    concurrency: AppConfig.queues.workerConcurrency || 5
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tokenId: job.data.tokenId }, 'Transfer job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tokenId: job?.data?.tokenId, error: err },
      'Transfer job failed'
    );
  });

  return worker;
};

export const createBlockchainSyncWorker = (
  handler: (job: Job<BlockchainSyncJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('sync-blockchain', handler, {
    connection: createQueueConnection(),
    concurrency: 2
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, blockchain: job.data.blockchain },
      'Blockchain sync job completed'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, blockchain: job?.data?.blockchain, error: err },
      'Blockchain sync job failed'
    );
  });

  return worker;
};

export const createComplianceVerificationWorker = (
  handler: (job: Job<ComplianceVerificationJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('verify-compliance', handler, {
    connection: createQueueConnection(),
    concurrency: 3
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, userId: job.data.userId }, 'Compliance verification completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, userId: job?.data?.userId, error: err },
      'Compliance verification failed'
    );
  });

  return worker;
};

export const createSettlementWorker = (
  handler: (job: Job<BlockchainSettlementJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('execute-blockchain-settlement', handler, {
    connection: createQueueConnection(),
    concurrency: 3
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tradeId: job.data.tradeId }, 'Settlement job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tradeId: job?.data?.tradeId, error: err },
      'Settlement job failed'
    );
  });

  return worker;
};

export const createNotificationWorker = (
  handler: (job: Job<TradeNotificationJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('send-trade-notification', handler, {
    connection: createQueueConnection(),
    concurrency: 10
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tradeId: job.data.tradeId }, 'Notification sent');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tradeId: job?.data?.tradeId, error: err },
      'Notification failed'
    );
  });

  return worker;
};

export const createAnalyticsWorker = (
  handler: (job: Job<AnalyticsUpdateJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('update-market-stats', handler, {
    connection: createQueueConnection(),
    concurrency: 5
  });

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, tradingPairId: job.data.tradingPairId },
      'Analytics updated'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tradingPairId: job?.data?.tradingPairId, error: err },
      'Analytics update failed'
    );
  });

  return worker;
};

export const createExternalPriceWorker = (
  handler: (job: Job<ExternalPriceJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('fetch-external-prices', handler, {
    connection: createQueueConnection(),
    concurrency: 5
  });

  worker.on('completed', (job) => {
    logger.debug(
      { jobId: job.id, pairSymbol: job.data.pairSymbol },
      'External price fetched'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, pairSymbol: job?.data?.pairSymbol, error: err },
      'External price fetch failed'
    );
  });

  return worker;
};

export const createCandleAggregationWorker = (
  handler: (job: Job<CandleAggregationJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('aggregate-candles', handler, {
    connection: createQueueConnection(),
    concurrency: 3
  });

  worker.on('completed', (job) => {
    logger.debug(
      { jobId: job.id, interval: job.data.interval },
      'Candle aggregation completed'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, interval: job?.data?.interval, error: err },
      'Candle aggregation failed'
    );
  });

  return worker;
};

export const createMetadataUpdateWorker = (
  handler: (job: Job<TokenMetadataUpdateJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('update-token-metadata', handler, {
    connection: createQueueConnection(),
    concurrency: 2
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, tokenId: job.data.tokenId }, 'Token metadata updated');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, tokenId: job?.data?.tokenId, error: err },
      'Token metadata update failed'
    );
  });

  return worker;
};

export const createWithdrawalWorker = (
  handler: (job: Job<WithdrawalProcessingJobData>) => Promise<void>
): Worker => {
  const worker = new Worker('process-withdrawal', handler, {
    connection: createQueueConnection(),
    concurrency: 3
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, withdrawalId: job.data.withdrawalId }, 'Withdrawal processed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, withdrawalId: job?.data?.withdrawalId, error: err },
      'Withdrawal processing failed'
    );
  });

  return worker;
};
