import { randomUUID } from 'crypto';

import { getDatabasePool } from '@infra/database';
import { MarketHistoryEvent } from '@app-types/market';

const mapRowToEvent = (row: any): MarketHistoryEvent => ({
  id: row.id,
  marketId: row.market_id,
  transactionHash: row.tx_hash,
  eventType: row.event_type,
  eventTimestamp: row.occurred_at,
  payload: row.payload
});

export const recordMarketEvent = async (
  input: Omit<MarketHistoryEvent, 'id'>
): Promise<MarketHistoryEvent> => {
  const pool = getDatabasePool();
  const id = randomUUID();

  const result = await pool.query(
    `
    INSERT INTO market_events (id, market_id, tx_hash, event_type, payload, occurred_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    ON CONFLICT (market_id, tx_hash, event_type) DO NOTHING
    RETURNING *
    `,
    [
      id,
      input.marketId,
      input.transactionHash,
      input.eventType,
      JSON.stringify(input.payload),
      input.eventTimestamp
    ]
  );

  if (result.rowCount === 0) {
    return {
      ...input,
      id
    };
  }

  return mapRowToEvent(result.rows[0]);
};

export const listMarketEvents = async (
  marketId: string
): Promise<MarketHistoryEvent[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    'SELECT * FROM market_events WHERE market_id = $1 ORDER BY occurred_at DESC',
    [marketId]
  );

  return result.rows.map(mapRowToEvent);
};
