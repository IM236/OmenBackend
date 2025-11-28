import { randomUUID } from 'crypto';
import { getDatabasePool } from '@infra/database';
import { MarketApprovalEvent, MarketApprovalEventType } from '@app-types/market';

const mapRowToEvent = (row: any): MarketApprovalEvent => ({
  id: row.id,
  marketId: row.market_id,
  eventType: row.event_type,
  actorId: row.actor_id,
  actorType: row.actor_type,
  decision: row.decision,
  reason: row.reason,
  metadata: row.metadata,
  createdAt: row.created_at
});

export interface CreateMarketApprovalEventInput {
  marketId: string;
  eventType: MarketApprovalEventType;
  actorId: string;
  actorType: string;
  decision?: string;
  reason?: string;
  metadata: Record<string, unknown>;
}

export const createMarketApprovalEvent = async (
  input: CreateMarketApprovalEventInput
): Promise<MarketApprovalEvent> => {
  const pool = getDatabasePool();
  const id = randomUUID();

  const result = await pool.query(
    `
    INSERT INTO market_approval_events (
      id, market_id, event_type, actor_id, actor_type, decision, reason, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    RETURNING *
    `,
    [
      id,
      input.marketId,
      input.eventType,
      input.actorId,
      input.actorType,
      input.decision || null,
      input.reason || null,
      JSON.stringify(input.metadata)
    ]
  );

  return mapRowToEvent(result.rows[0]);
};

export const listMarketApprovalEvents = async (
  marketId: string
): Promise<MarketApprovalEvent[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    SELECT *
    FROM market_approval_events
    WHERE market_id = $1
    ORDER BY created_at DESC
    `,
    [marketId]
  );

  return result.rows.map(mapRowToEvent);
};

export const listEventsByType = async (
  eventType: MarketApprovalEventType,
  limit: number = 100
): Promise<MarketApprovalEvent[]> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    SELECT *
    FROM market_approval_events
    WHERE event_type = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [eventType, limit]
  );

  return result.rows.map(mapRowToEvent);
};

export const getLatestEventForMarket = async (
  marketId: string
): Promise<MarketApprovalEvent | null> => {
  const pool = getDatabasePool();
  const result = await pool.query(
    `
    SELECT *
    FROM market_approval_events
    WHERE market_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [marketId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapRowToEvent(result.rows[0]);
};
