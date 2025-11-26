import { getMarketEventListener } from '@infra/events';
import { MarketService } from '@services/marketService';

let marketService: MarketService | null = null;

export const getMarketService = (): MarketService => {
  if (!marketService) {
    marketService = new MarketService(getMarketEventListener());
  }

  return marketService;
};
