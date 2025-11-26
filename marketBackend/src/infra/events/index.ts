import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';
import { MarketEventListener } from '@services/eventListenerService';

let marketEventListener: MarketEventListener | null = null;

export const initializeEventListeners = async (): Promise<void> => {
  if (!AppConfig.features.websockets) {
    logger.info('WebSocket listeners disabled via configuration');
    return;
  }

  marketEventListener = new MarketEventListener();
  await marketEventListener.start();
  logger.info('Market event listener started');
};

export const shutdownEventListeners = async (): Promise<void> => {
  if (!marketEventListener) {
    return;
  }

  await marketEventListener.stop();
  marketEventListener = null;
  logger.info('Market event listener stopped');
};

export const getMarketEventListener = (): MarketEventListener => {
  if (!marketEventListener) {
    marketEventListener = new MarketEventListener();
  }

  return marketEventListener;
};
