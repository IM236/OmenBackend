import {
  listMarketEvents,
  recordMarketEvent
} from '@infra/database/repositories/marketEventRepository';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { MarketHistoryEvent } from '@app-types/market';

export const decryptEventPayload = async (
  event: MarketHistoryEvent
): Promise<MarketHistoryEvent> => {
  // TODO: Replace with Sapphire view key decryption.
  return event;
};

export const ensureIdempotentProcessing = async (
  event: MarketHistoryEvent
): Promise<void> => {
  const existingEvents = await listMarketEvents(event.marketId);
  const alreadyProcessed = existingEvents.some(
    (existing) =>
      existing.transactionHash === event.transactionHash &&
      existing.eventType === event.eventType
  );

  if (alreadyProcessed) {
    throw new ApplicationError('Event already processed', {
      statusCode: 409,
      code: 'event_already_processed'
    });
  }
};

export const processMarketEvent = async (
  event: MarketHistoryEvent
): Promise<void> => {
  try {
    await ensureIdempotentProcessing(event);
    await recordMarketEvent({
      marketId: event.marketId,
      transactionHash: event.transactionHash,
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp,
      payload: event.payload
    });
    // TODO: update markets table & trigger workflows.
  } catch (error) {
    logger.error(
      { eventId: event.id, error },
      'Failed to process market event (stub)'
    );
    throw error;
  }
};
