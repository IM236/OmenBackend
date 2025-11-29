import { Job } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { sapphireRpcClient } from '@clients/sapphireRpcClient';
import { updateTradeSettlement } from '@infra/database/repositories/tradingRepository';
import { tradingEventPublisher } from '@lib/events/tradingEventPublisher';
import { BlockchainSettlementJobData } from '@infra/queue/workers';

/**
 * Settlement Service for executing on-chain trade settlements via Sapphire
 */
export class SettlementService {
  /**
   * Execute blockchain settlement for a trade
   * This is called by the BullMQ worker
   */
  async executeSettlement(job: Job<BlockchainSettlementJobData>): Promise<void> {
    const { tradeId, tradingPairId } = job.data;

    logger.info(
      { tradeId, tradingPairId, jobId: job.id },
      'Starting blockchain settlement'
    );

    try {
      const txHash = await this.settleTrade(tradeId, tradingPairId);

      await updateTradeSettlement(tradeId, 'SETTLED', txHash);

      await tradingEventPublisher.publishTradeSettled(tradeId, txHash);

      logger.info(
        { tradeId, txHash, jobId: job.id },
        'Blockchain settlement completed'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        { error, tradeId, jobId: job.id },
        'Blockchain settlement failed'
      );

      if (job.attemptsMade < 5) {
        throw error;
      }

      await updateTradeSettlement(tradeId, 'FAILED');
      await tradingEventPublisher.publishTradeSettlementFailed(tradeId, errorMessage);
    }
  }

  /**
   * Settle trade on Sapphire blockchain
   * This would call the Sapphire contract to record the settlement
   */
  private async settleTrade(tradeId: string, tradingPairId: string): Promise<string> {
    try {
      const result = await sapphireRpcClient.call<{ txHash: string }>(
        'sapphire_settleTrade',
        [
          {
            tradeId,
            tradingPairId
          }
        ]
      );

      if (!result.txHash) {
        throw new ApplicationError('No transaction hash returned from Sapphire', {
          statusCode: 502,
          code: 'sapphire_settlement_error'
        });
      }

      return result.txHash;
    } catch (error) {
      logger.error({ error, tradeId }, 'Failed to settle trade on Sapphire');
      throw new ApplicationError('Sapphire settlement failed', {
        statusCode: 502,
        code: 'sapphire_settlement_failed',
        details: { tradeId, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  /**
   * Verify settlement status on-chain
   * This can be called to check if a settlement was successful
   */
  async verifySettlement(tradeId: string, txHash: string): Promise<boolean> {
    try {
      const result = await sapphireRpcClient.call<{ confirmed: boolean }>(
        'sapphire_verifySettlement',
        [{ tradeId, txHash }]
      );

      return result.confirmed;
    } catch (error) {
      logger.error({ error, tradeId, txHash }, 'Failed to verify settlement');
      return false;
    }
  }

  /**
   * Batch settle multiple trades (for optimization)
   */
  async batchSettleTrades(tradeIds: string[]): Promise<Map<string, string>> {
    const settlements = new Map<string, string>();

    try {
      const result = await sapphireRpcClient.call<{ settlements: Array<{ tradeId: string; txHash: string }> }>(
        'sapphire_batchSettleTrades',
        [{ tradeIds }]
      );

      for (const settlement of result.settlements) {
        settlements.set(settlement.tradeId, settlement.txHash);
        await updateTradeSettlement(settlement.tradeId, 'SETTLED', settlement.txHash);
        await tradingEventPublisher.publishTradeSettled(settlement.tradeId, settlement.txHash);
      }

      logger.info(
        { count: settlements.size, tradeIds },
        'Batch settlement completed'
      );
    } catch (error) {
      logger.error({ error, tradeIds }, 'Batch settlement failed');
      throw error;
    }

    return settlements;
  }
}

export const settlementService = new SettlementService();
