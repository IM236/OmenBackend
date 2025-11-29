import { Job } from 'bullmq';
import { logger } from '@infra/logging/logger';
import { sapphireRpcClient } from '@clients/sapphireRpcClient';
import { getDatabasePool } from '@infra/database';
import { listActiveTokens, getUserBalances } from '@infra/database/repositories/tokenRepository';
import { updateTradeSettlement } from '@infra/database/repositories/tradingRepository';

export interface ReconciliationResult {
  tokensChecked: number;
  balancesChecked: number;
  discrepanciesFound: number;
  discrepancies: Array<{
    type: 'balance' | 'trade_settlement';
    userId?: string;
    tokenId?: string;
    tradeId?: string;
    dbValue: string;
    onChainValue: string;
    action: 'updated' | 'flagged';
  }>;
}

/**
 * Blockchain Reconciliation Service
 *
 * Periodically compares database state with on-chain state
 * and updates discrepancies.
 */
export class BlockchainReconciliationService {
  /**
   * Perform full reconciliation
   */
  async performReconciliation(): Promise<ReconciliationResult> {
    logger.info('Starting blockchain reconciliation');

    const result: ReconciliationResult = {
      tokensChecked: 0,
      balancesChecked: 0,
      discrepanciesFound: 0,
      discrepancies: []
    };

    try {
      // Reconcile token balances
      await this.reconcileTokenBalances(result);

      // Reconcile pending trade settlements
      await this.reconcilePendingSettlements(result);

      logger.info(
        {
          tokensChecked: result.tokensChecked,
          balancesChecked: result.balancesChecked,
          discrepanciesFound: result.discrepanciesFound
        },
        'Blockchain reconciliation completed'
      );

      return result;
    } catch (error) {
      logger.error({ error }, 'Blockchain reconciliation failed');
      throw error;
    }
  }

  /**
   * Reconcile token balances between DB and blockchain
   */
  private async reconcileTokenBalances(result: ReconciliationResult): Promise<void> {
    const tokens = await listActiveTokens();
    result.tokensChecked = tokens.length;

    for (const token of tokens) {
      // Skip tokens without contract addresses
      if (!token.contractAddress) {
        continue;
      }

      try {
        // Get on-chain total supply
        const onChainSupply = await this.getOnChainTotalSupply(token.contractAddress);

        // Compare with DB total supply
        if (token.totalSupply && onChainSupply !== token.totalSupply) {
          logger.warn(
            {
              tokenId: token.id,
              tokenSymbol: token.tokenSymbol,
              dbSupply: token.totalSupply,
              onChainSupply
            },
            'Token supply mismatch detected'
          );

          result.discrepanciesFound++;
          result.discrepancies.push({
            type: 'balance',
            tokenId: token.id,
            dbValue: token.totalSupply,
            onChainValue: onChainSupply,
            action: 'flagged'
          });
        }

        // Reconcile individual user balances for this token
        await this.reconcileTokenUserBalances(token.id, token.contractAddress, result);
      } catch (error) {
        logger.error(
          { error, tokenId: token.id, tokenSymbol: token.tokenSymbol },
          'Failed to reconcile token'
        );
      }
    }
  }

  /**
   * Reconcile user balances for a specific token
   */
  private async reconcileTokenUserBalances(
    tokenId: string,
    contractAddress: string,
    result: ReconciliationResult
  ): Promise<void> {
    const pool = getDatabasePool();

    // Get all users with balances for this token
    const usersResult = await pool.query(
      `SELECT DISTINCT user_id FROM user_balances WHERE token_id = $1 AND (available_balance != '0' OR locked_balance != '0')`,
      [tokenId]
    );

    for (const row of usersResult.rows) {
      const userId = row.user_id;
      result.balancesChecked++;

      try {
        // Get user's address (assuming user_id is wallet address or we have mapping)
        const userAddress = userId; // Adjust if you have user_id -> address mapping

        // Get on-chain balance
        const onChainBalance = await this.getOnChainBalance(contractAddress, userAddress);

        // Get DB balance (available + locked)
        const balanceResult = await pool.query(
          `SELECT available_balance, locked_balance FROM user_balances WHERE user_id = $1 AND token_id = $2`,
          [userId, tokenId]
        );

        if (balanceResult.rows.length > 0) {
          const dbAvailable = balanceResult.rows[0].available_balance;
          const dbLocked = balanceResult.rows[0].locked_balance;
          const dbTotal = (BigInt(dbAvailable) + BigInt(dbLocked)).toString();

          if (onChainBalance !== dbTotal) {
            logger.warn(
              {
                userId,
                tokenId,
                dbTotal,
                onChainBalance
              },
              'User balance mismatch detected'
            );

            // Update database to match on-chain
            await pool.query(
              `UPDATE user_balances
               SET available_balance = $1,
                   locked_balance = '0',
                   updated_at = NOW()
               WHERE user_id = $2 AND token_id = $3`,
              [onChainBalance, userId, tokenId]
            );

            result.discrepanciesFound++;
            result.discrepancies.push({
              type: 'balance',
              userId,
              tokenId,
              dbValue: dbTotal,
              onChainValue: onChainBalance,
              action: 'updated'
            });
          }
        }
      } catch (error) {
        logger.error(
          { error, userId, tokenId },
          'Failed to reconcile user balance'
        );
      }
    }
  }

  /**
   * Reconcile pending trade settlements
   */
  private async reconcilePendingSettlements(result: ReconciliationResult): Promise<void> {
    const pool = getDatabasePool();

    // Get trades that are pending settlement for more than 5 minutes
    const tradesResult = await pool.query(
      `SELECT id, blockchain_tx_hash
       FROM trades
       WHERE settlement_status = 'PENDING'
         AND executed_at < NOW() - INTERVAL '5 minutes'
       LIMIT 100`
    );

    for (const row of tradesResult.rows) {
      const tradeId = row.id;
      const txHash = row.blockchain_tx_hash;

      try {
        // If we have a tx hash, verify it on-chain
        if (txHash) {
          const isSettled = await this.verifySettlementOnChain(txHash);

          if (isSettled) {
            logger.info({ tradeId, txHash }, 'Trade settlement verified on-chain, updating DB');

            await updateTradeSettlement(tradeId, 'SETTLED', txHash);

            result.discrepanciesFound++;
            result.discrepancies.push({
              type: 'trade_settlement',
              tradeId,
              dbValue: 'PENDING',
              onChainValue: 'SETTLED',
              action: 'updated'
            });
          }
        } else {
          // No tx hash, trade might have failed
          logger.warn({ tradeId }, 'Trade pending without tx hash for too long');

          result.discrepancies.push({
            type: 'trade_settlement',
            tradeId,
            dbValue: 'PENDING',
            onChainValue: 'UNKNOWN',
            action: 'flagged'
          });
        }
      } catch (error) {
        logger.error({ error, tradeId, txHash }, 'Failed to reconcile trade settlement');
      }
    }
  }

  /**
   * Get on-chain total supply for a token
   */
  private async getOnChainTotalSupply(contractAddress: string): Promise<string> {
    try {
      const result = await sapphireRpcClient.call<{ totalSupply: string }>(
        'sapphire_getTotalSupply',
        [contractAddress]
      );
      return result.totalSupply;
    } catch (error) {
      logger.warn({ error, contractAddress }, 'Failed to get on-chain total supply');
      throw error;
    }
  }

  /**
   * Get on-chain balance for a user
   */
  private async getOnChainBalance(contractAddress: string, userAddress: string): Promise<string> {
    try {
      const result = await sapphireRpcClient.call<{ balance: string }>(
        'sapphire_getBalance',
        [contractAddress, userAddress]
      );
      return result.balance;
    } catch (error) {
      logger.warn({ error, contractAddress, userAddress }, 'Failed to get on-chain balance');
      throw error;
    }
  }

  /**
   * Verify if a settlement transaction is confirmed on-chain
   */
  private async verifySettlementOnChain(txHash: string): Promise<boolean> {
    try {
      const result = await sapphireRpcClient.call<{ confirmed: boolean, status: string }>(
        'sapphire_getTransactionStatus',
        [txHash]
      );
      return result.confirmed && result.status === 'success';
    } catch (error) {
      logger.warn({ error, txHash }, 'Failed to verify settlement on-chain');
      return false;
    }
  }
}

export const blockchainReconciliationService = new BlockchainReconciliationService();
