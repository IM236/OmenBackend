import { Job } from 'bullmq';
import { getSapphireTokenClient } from '@clients/sapphireTokenClient';
import { AppConfig } from '@config';
import { marketEventBroker } from '@infra/eventBroker/marketEventBroker';
import {
  activateMarket,
  updateMarketStatus,
  findMarketById
} from '@infra/database/repositories/marketRepository';
import { createToken, findTokenBySymbol } from '@infra/database/repositories/tokenRepository';
import { createTradingPair, findTradingPairByMarketId } from '@infra/database/repositories/tradingRepository';
import { usdcTokenService } from '@services/usdcTokenService';
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

    // Create token record in database
    let rwaToken = await findTokenBySymbol(tokenSymbol);
    if (!rwaToken) {
      rwaToken = await createToken({
        tokenSymbol,
        tokenName,
        tokenType: 'RWA',
        contractAddress: deployment.address,
        blockchain: 'sapphire',
        decimals,
        totalSupply,
        metadata: {
          marketId,
          assetType: market.assetType,
          deploymentTxHash: deployment.txHash
        }
      });

      logger.info(
        { tokenId: rwaToken.id, tokenSymbol, marketId },
        'RWA token record created'
      );
    }

    // Create trading pair with USDC
    const usdcTokenId = await usdcTokenService.getUsdcTokenId();

    const existingPair = await findTradingPairByMarketId(marketId);
    if (!existingPair) {
      const tradingPair = await createTradingPair({
        marketId,
        baseTokenId: rwaToken.id,
        quoteTokenId: usdcTokenId,
        pairSymbol: `${tokenSymbol}-USDC`,
        minOrderSize: '1',
        maxOrderSize: totalSupply,
        pricePrecision: 6,
        quantityPrecision: parseInt(decimals.toString()),
        metadata: {
          assetType: market.assetType,
          marketName: market.name,
          createdBy: 'system'
        }
      });

      logger.info(
        { tradingPairId: tradingPair.id, pairSymbol: tradingPair.pairSymbol, marketId },
        'Trading pair created for RWA market'
      );
    }

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
        tokenId: rwaToken.id,
        tradingPairCreated: true,
        jobId: job.id
      }
    });

    logger.info(
      { jobId: job.id, marketId, contractAddress: deployment.address },
      'Market activated successfully with trading pair'
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
