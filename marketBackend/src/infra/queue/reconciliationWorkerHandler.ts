import { Job, Worker } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { createQueueConnection, registerWorker, getReconciliationQueue } from '@infra/queue';
import { blockchainReconciliationService } from '@services/blockchainReconciliationService';

/**
 * Reconciliation worker handler
 * Performs periodic blockchain reconciliation
 */
const handleReconciliationJob = async (job: Job): Promise<void> => {
  logger.info({ jobId: job.id }, 'Starting blockchain reconciliation job');

  const result = await blockchainReconciliationService.performReconciliation();

  logger.info(
    {
      jobId: job.id,
      tokensChecked: result.tokensChecked,
      balancesChecked: result.balancesChecked,
      discrepanciesFound: result.discrepanciesFound
    },
    'Blockchain reconciliation job completed'
  );

  // Log discrepancies for monitoring
  if (result.discrepanciesFound > 0) {
    logger.warn(
      {
        jobId: job.id,
        discrepancies: result.discrepancies
      },
      'Blockchain discrepancies detected and processed'
    );
  }

  return;
};

/**
 * Initialize the reconciliation worker
 */
export const initializeReconciliationWorker = (): void => {
  const worker = new Worker('blockchain-reconciliation', handleReconciliationJob, {
    connection: createQueueConnection(),
    concurrency: 1 // Only one reconciliation at a time
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Reconciliation job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, error: err },
      'Reconciliation job failed'
    );
  });

  registerWorker(worker);

  logger.info('Reconciliation worker initialized');
};

/**
 * Schedule periodic reconciliation (every 15 minutes)
 */
export const scheduleReconciliation = async (): Promise<void> => {
  const queue = getReconciliationQueue();

  // Add repeatable job every 15 minutes
  await queue.add(
    'periodic-reconciliation',
    {},
    {
      repeat: {
        pattern: '*/15 * * * *' // Every 15 minutes
      },
      jobId: 'recurring-reconciliation'
    }
  );

  logger.info('Periodic blockchain reconciliation scheduled (every 15 minutes)');
};
