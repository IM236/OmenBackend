import { Job } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { createSwapWorker, SwapJobData } from '@infra/queue/workers';
import { registerWorker } from '@infra/queue';
import { getSwapService } from '@services/factory';

let swapWorker: ReturnType<typeof createSwapWorker> | null = null;

const handleSwapJob = async (job: Job<SwapJobData>): Promise<void> => {
  logger.info({ jobId: job.id, swapId: job.data.swapId }, 'Processing swap job');

  const swapService = getSwapService();
  await swapService.processSwapJob(job);
};

export const initializeSwapWorker = (): void => {
  if (swapWorker) {
    logger.warn('Swap worker already initialized');
    return;
  }

  swapWorker = createSwapWorker(handleSwapJob);
  registerWorker(swapWorker);

  logger.info('Swap worker initialized');
};

export const getSwapWorker = () => swapWorker;
