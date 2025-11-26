import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';

import { AppConfig } from '@config';
import {
  createTransaction,
  findTransactionById,
  updateTransactionStatus
} from '@infra/database/repositories/transactionRepository';
import {
  getDeadLetterQueue,
  getTransactionQueue,
  registerTransactionWorker,
  createQueueConnection
} from '@infra/queue';
import { logger } from '@infra/logging/logger';
import { encryptCalldata } from '@lib/encryption/encryptedCalldata';
import { ApplicationError } from '@lib/errors';
import { TransactionJobPayload, TransactionRecord } from '@types/transaction';

type WorkerJob = Job<TransactionJobPayload>;

export class TransactionManager {
  private readonly transactionQueue = getTransactionQueue();
  private worker: Worker<TransactionJobPayload> | null = null;

  async start(): Promise<void> {
    if (this.worker) {
      return;
    }

    const connection = this.createConnection();

    this.worker = new Worker<TransactionJobPayload>(
      AppConfig.queues.transactionQueue,
      async (job) => {
        await this.processJob(job);
      },
      {
        connection,
        concurrency: 1
      }
    );

    this.worker.on('failed', async (job, error) => {
      logger.error({ jobId: job?.id, error }, 'Transaction job failed');
      if (job) {
        const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
        await updateTransactionStatus({
          id: job.data.metadata.transactionId as string,
          status: isFinalAttempt ? 'dropped' : 'failed',
          errorReason: error instanceof Error ? error.message : 'unknown error'
        });

        if (isFinalAttempt) {
          const dlq = getDeadLetterQueue();
          await dlq.add('dead-letter', job.data, { attempts: 1 });
          await this.notifyDeadLetter(job, error);
        }
      }
    });

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Transaction job completed');
    });

    registerTransactionWorker(this.worker);
  }

  async stop(): Promise<void> {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
    this.worker = null;
  }

  async enqueueTransaction(payload: TransactionJobPayload): Promise<TransactionRecord> {
    const record = await createTransaction({
      marketId: payload.marketId,
      status: 'pending',
      payload: payload.metadata,
      jobId: ''
    });

    const job = await this.transactionQueue.add(
      'market-transaction',
      {
        ...payload,
        metadata: {
          ...payload.metadata,
          transactionId: record.id
        }
      },
      {
        jobId: record.id,
        attempts: AppConfig.queues.maxRetryAttempts,
        backoff: {
          type: 'exponential',
          delay: AppConfig.queues.retryBackoffMs
        }
      }
    );

    await updateTransactionStatus({
      id: record.id,
      status: 'in_progress'
    });

    return record;
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    return findTransactionById(transactionId);
  }

  private async processJob(job: WorkerJob): Promise<void> {
    try {
      const encryptedCalldata = await encryptCalldata(job.data.calldata);
      logger.info(
        {
          jobId: job.id,
          marketId: job.data.marketId
        },
        'Submitting Sapphire transaction (stub)'
      );

      // TODO: Integrate with Sapphire client to submit transaction.
      const simulatedTxHash = `0x${job.id}`;

      await updateTransactionStatus({
        id: job.data.metadata.transactionId as string,
        status: 'confirmed',
        txHash: simulatedTxHash
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown transaction failure';
      throw new ApplicationError(message, {
        statusCode: 500,
        code: 'transaction_failed'
      });
    }
  }

  private createConnection(): Redis {
    return createQueueConnection();
  }

  private async notifyDeadLetter(job: WorkerJob, error: unknown): Promise<void> {
    logger.error(
      {
        jobId: job.id,
        marketId: job.data.marketId,
        error
      },
      'Transaction moved to dead-letter queue (alert hook placeholder)'
    );
  }
}
