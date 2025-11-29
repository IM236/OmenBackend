import { getMarketEventListener } from '@infra/events';
import { MarketService } from '@services/marketService';
import { TradingService } from '@services/tradingService';
import { TokenService } from '@services/tokenService';
import {
  getSettlementQueue,
  getNotificationQueue,
  getAnalyticsQueue,
  getMatchingQueue,
  getMintTokenQueue,
  getTransferQueue,
  getBlockchainSyncQueue,
  getComplianceQueue
} from '@infra/queue';
import { createEIP712Verifier } from '@lib/signature/eip712';
import { AppConfig } from '@config';

let marketService: MarketService | null = null;
let tradingService: TradingService | null = null;
let tokenService: TokenService | null = null;

export const getMarketService = (): MarketService => {
  if (!marketService) {
    marketService = new MarketService(getMarketEventListener());
  }

  return marketService;
};

export const getTradingService = (): TradingService => {
  if (!tradingService) {
    const chainId = parseInt(AppConfig.sapphire.chainId.split('-')[1] || '23294', 10);
    const eip712Verifier = createEIP712Verifier(chainId);

    tradingService = new TradingService(
      getTokenService(),
      getSettlementQueue(),
      getNotificationQueue(),
      getAnalyticsQueue(),
      getMatchingQueue(),
      eip712Verifier
    );
  }

  return tradingService;
};

export const getTokenService = (): TokenService => {
  if (!tokenService) {
    tokenService = new TokenService(
      getMintTokenQueue(),
      getTransferQueue(),
      getBlockchainSyncQueue(),
      getComplianceQueue()
    );
  }

  return tokenService;
};
