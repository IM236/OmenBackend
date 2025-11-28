import { getPool } from '../pool';

export interface ProcessedEvent {
  id: string;
  eventId: string;
  eventType: string;
  source: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
  processedAt: Date;
  processingStatus: 'success' | 'failed' | 'skipped';
  processingError?: string;
}

export interface CreateProcessedEventInput {
  eventId: string;
  eventType: string;
  source: string;
  payload?: Record<string, unknown>;
  context?: Record<string, unknown>;
  processingStatus?: 'success' | 'failed' | 'skipped';
  processingError?: string;
}

/**
 * Check if an event has already been processed
 *
 * @param eventId - Unique event identifier from external system
 * @returns true if event exists in processed_events table
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1 FROM processed_events WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

/**
 * Record that an event has been processed
 *
 * This function is idempotent - if the event already exists, it returns the existing record.
 *
 * @param input - Event details to record
 * @returns The processed event record
 */
export async function recordProcessedEvent(
  input: CreateProcessedEventInput
): Promise<ProcessedEvent> {
  const pool = getPool();

  // Use INSERT ... ON CONFLICT to ensure idempotency
  const result = await pool.query(
    `
    INSERT INTO processed_events (
      event_id,
      event_type,
      source,
      payload,
      context,
      processing_status,
      processing_error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (event_id) DO UPDATE
      SET processed_at = CURRENT_TIMESTAMP,
          processing_status = EXCLUDED.processing_status,
          processing_error = EXCLUDED.processing_error
    RETURNING *
    `,
    [
      input.eventId,
      input.eventType,
      input.source,
      JSON.stringify(input.payload || {}),
      JSON.stringify(input.context || {}),
      input.processingStatus || 'success',
      input.processingError || null
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    source: row.source,
    payload: row.payload,
    context: row.context,
    processedAt: row.processed_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error
  };
}

/**
 * Get a processed event by ID
 */
export async function findProcessedEventById(eventId: string): Promise<ProcessedEvent | null> {
  const pool = getPool();
  const result = await pool.query(`SELECT * FROM processed_events WHERE event_id = $1`, [eventId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    source: row.source,
    payload: row.payload,
    context: row.context,
    processedAt: row.processed_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error
  };
}

/**
 * List processed events with filters
 */
export async function listProcessedEvents(params: {
  eventType?: string;
  source?: string;
  processingStatus?: 'success' | 'failed' | 'skipped';
  limit?: number;
  offset?: number;
}): Promise<ProcessedEvent[]> {
  const pool = getPool();

  const conditions: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (params.eventType) {
    conditions.push(`event_type = $${paramCount++}`);
    values.push(params.eventType);
  }

  if (params.source) {
    conditions.push(`source = $${paramCount++}`);
    values.push(params.source);
  }

  if (params.processingStatus) {
    conditions.push(`processing_status = $${paramCount++}`);
    values.push(params.processingStatus);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const query = `
    SELECT * FROM processed_events
    ${whereClause}
    ORDER BY processed_at DESC
    LIMIT $${paramCount++} OFFSET $${paramCount++}
  `;

  values.push(limit, offset);

  const result = await pool.query(query, values);

  return result.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    source: row.source,
    payload: row.payload,
    context: row.context,
    processedAt: row.processed_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error
  }));
}

/**
 * Get count of failed events for monitoring
 */
export async function getFailedEventsCount(
  since?: Date
): Promise<{ count: number; oldestFailure: Date | null }> {
  const pool = getPool();

  const sinceClause = since ? `AND processed_at >= $1` : '';
  const values = since ? [since] : [];

  const result = await pool.query(
    `
    SELECT
      COUNT(*) as count,
      MIN(processed_at) as oldest_failure
    FROM processed_events
    WHERE processing_status = 'failed' ${sinceClause}
    `,
    values
  );

  return {
    count: parseInt(result.rows[0].count, 10),
    oldestFailure: result.rows[0].oldest_failure
  };
}

/**
 * Delete old processed events (for cleanup jobs)
 *
 * @param olderThan - Delete events processed before this date
 * @returns Number of deleted records
 */
export async function deleteOldProcessedEvents(olderThan: Date): Promise<number> {
  const pool = getPool();

  const result = await pool.query(
    `
    DELETE FROM processed_events
    WHERE processed_at < $1
      AND processing_status = 'success'
    `,
    [olderThan]
  );

  return result.rowCount || 0;
}
