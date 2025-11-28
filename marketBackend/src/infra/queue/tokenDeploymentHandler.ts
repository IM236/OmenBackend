import { Job } from 'bullmq';
import { getSapphireTokenClient } from '@clients/sapphireTokenClient';
import { AppConfig } from '@config';
import { marketEventBroker } from '@infra/eventBroker/marketEventBroker';
import {
  activateMarket,
  updateMarketStatus,
  findMarketById
} from '@infra/database/repositories/marketRepository';
import { logger } from '@infra/logging/logger';
import { TokenDeploymentJobData, createTokenDeploymentWorker } from './workers';
import { registerWorker } from './index';

/**
 * Token Deployment Worker Handler
 *
 * This worker processes token deployment jobs for market activation.
 * It handles the blockchain deployment and updates the market status accordingly.
 *
 * Flow:
 * 1. Receives job with market details
 * 2. Deploys token contract to Sapphire blockchain
 * 3. Updates market with contract address and sets status to 'active'
 * 4. Publishes activation completed event
 * 5. On failure, reverts market to 'approved' status for retry
 */
export const handleTokenDeployment = async (
  job: Job<TokenDeploymentJobData>
): Promise<void> => {
  const { marketId, tokenName, tokenSymbol, decimals, totalSupply, actorId } = job.data;

  logger.info(
    { jobId: job.id, marketId, tokenSymbol },
    'Processing token deployment job'
  );

  try {
    // Verify market is still in activating state
    const market = await findMarketById(marketId);
    if (!market) {
      throw new Error(`Market ${marketId} not found`);
    }

    if (market.status !== 'activating') {
      logger.warn(
        { marketId, currentStatus: market.status },
        'Market is not in activating state, skipping deployment'
      );
      return;
    }

    // Deploy token to Sapphire
    const sapphireClient = getSapphireTokenClient();
    const deployment = await sapphireClient.deployToken({
      name: tokenName,
      symbol: tokenSymbol,
      decimals,
      initialSupply: totalSupply,
      signerPrivateKey: AppConfig.sapphire.privateKey || ''
    });

    logger.info(
      {
        jobId: job.id,
        marketId,
        contractAddress: deployment.address,
        txHash: deployment.txHash
      },
      'Token deployed successfully'
    );

    // Update market with deployment info and set to active
    const activatedMarket = await activateMarket(
      marketId,
      deployment.address,
      deployment.txHash
    );

    // Publish activation completed event
    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.activated',
      actorId,
      actorType: 'system',
      metadata: {
        contractAddress: deployment.address,
        txHash: deployment.txHash,
        tokenSymbol,
        jobId: job.id
      }
    });

    logger.info(
      { jobId: job.id, marketId, contractAddress: deployment.address },
      'Market activated successfully'
    );
  } catch (error) {
    logger.error({ error, jobId: job.id, marketId }, 'Token deployment failed');

    // Revert to approved status on failure to allow retry or manual intervention
    await updateMarketStatus(marketId, 'approved', {
      activationError: String(error),
      activationAttemptedAt: new Date().toISOString(),
      lastFailedJobId: job.id
    });

    // Publish failure event
    await marketEventBroker.publishEvent({
      marketId,
      eventType: 'market.activation_failed' as any,
      actorId,
      actorType: 'system',
      metadata: {
        error: String(error),
        jobId: job.id,
        attemptNumber: job.attemptsMade
      }
    });

    // Re-throw to let BullMQ handle retry logic
    throw error;
  }
};

/**
 * Initialize and register the token deployment worker
 */
export const initializeTokenDeploymentWorker = (): void => {
  const worker = createTokenDeploymentWorker(handleTokenDeployment);
  registerWorker(worker);
  logger.info('Token deployment worker initialized');
};
