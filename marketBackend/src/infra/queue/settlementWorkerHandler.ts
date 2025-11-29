import { Job } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { createSettlementWorker, BlockchainSettlementJobData } from '@infra/queue/workers';
import { registerWorker } from '@infra/queue';
import { settlementService } from '@services/settlementService';

let settlementWorker: ReturnType<typeof createSettlementWorker> | null = null;

/**
 * Settlement worker handler
 * Processes blockchain settlement jobs from the queue
 */
const handleSettlementJob = async (job: Job<BlockchainSettlementJobData>): Promise<void> => {
  logger.info(
    { jobId: job.id, tradeId: job.data.tradeId },
    'Processing settlement job'
  );

  await settlementService.executeSettlement(job);
};

/**
 * Initialize the settlement worker
 */
export const initializeSettlementWorker = (): void => {
  if (settlementWorker) {
    logger.warn('Settlement worker already initialized');
    return;
  }

  settlementWorker = createSettlementWorker(handleSettlementJob);
  registerWorker(settlementWorker);

  logger.info('Settlement worker initialized');
};

export const getSettlementWorker = () => settlementWorker;
