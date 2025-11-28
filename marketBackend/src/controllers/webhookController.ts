import { Request, Response } from 'express';
import { marketEventBroker } from '@infra/eventBroker/marketEventBroker';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { MarketService } from '@services/marketService';
import {
  isEventProcessed,
  recordProcessedEvent
} from '@infra/database/repositories/processedEventRepository';

/**
 * Webhook Controller - Receives events from external services
 *
 * Endpoints:
 * 1. POST /webhooks/entity-permissions - Entity Permissions Core approval decisions
 */

const marketService = new MarketService();

/**
 * Handle webhook from Entity Permissions Core
 *
 * This endpoint receives approval/rejection decisions from the Entity_Permissions_Core
 * service. Events are published to SNS and delivered here via webhook or SQS.
 *
 * POST /api/v1/webhooks/entity-permissions
 *
 * Expected payload format (SNS message):
 * {
 *   "Type": "Notification",
 *   "MessageId": "...",
 *   "Message": "{\"event_id\":\"...\",\"event_type\":\"market.approved\",\"payload\":{...}}",
 *   "Timestamp": "...",
 *   "Signature": "...",
 *   "SigningCertURL": "...",
 *   "UnsubscribeURL": "..."
 * }
 *
 * Or direct event format:
 * {
 *   "event_id": "uuid",
 *   "event_type": "market.approved" | "market.rejected",
 *   "source": "entity_permissions_core",
 *   "occurred_at": "2025-01-15T...",
 *   "payload": {
 *     "market_id": "uuid",
 *     "entity_id": "uuid",
 *     "decision": "approved" | "rejected",
 *     "reason": "..."
 *   },
 *   "context": {
 *     "actor_id": "admin-uuid",
 *     "actor_type": "admin"
 *   }
 * }
 */
export const handleEntityPermissionsWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Handle SNS message format
    let event;
    if (body.Type === 'Notification' && body.Message) {
      // SNS wraps the actual event in a Message field
      try {
        event = JSON.parse(body.Message);
      } catch (error) {
        logger.error({ error, body }, 'Failed to parse SNS message');
        throw new ApplicationError('Invalid SNS message format', {
          statusCode: 400,
          code: 'invalid_sns_message'
        });
      }
    } else if (body.event_id && body.event_type) {
      // Direct event format
      event = body;
    } else {
      throw new ApplicationError('Invalid webhook payload format', {
        statusCode: 400,
        code: 'invalid_webhook_payload'
      });
    }

    // Validate required fields
    if (!event.event_id || !event.event_type || !event.payload) {
      throw new ApplicationError('Missing required event fields', {
        statusCode: 400,
        code: 'missing_event_fields'
      });
    }

    // Check if event has already been processed (idempotency)
    const alreadyProcessed = await isEventProcessed(event.event_id);
    if (alreadyProcessed) {
      logger.info(
        { eventId: event.event_id, eventType: event.event_type },
        'Event already processed, skipping'
      );
      res.status(200).json({
        received: true,
        eventId: event.event_id,
        status: 'already_processed'
      });
      return;
    }

    logger.info(
      {
        eventId: event.event_id,
        eventType: event.event_type,
        source: event.source
      },
      'Received webhook event from Entity Permissions Core'
    );

    // Route based on event type
    try {
      if (event.event_type === 'market.approved' || event.event_type === 'market.rejected') {
        await handleMarketApprovalDecision(event);

        // Record successful processing
        await recordProcessedEvent({
          eventId: event.event_id,
          eventType: event.event_type,
          source: event.source || 'entity_permissions_core',
          payload: event.payload || {},
          context: event.context || {},
          processingStatus: 'success'
        });
      } else {
        logger.warn({ eventType: event.event_type }, 'Unhandled webhook event type');

        // Record as skipped
        await recordProcessedEvent({
          eventId: event.event_id,
          eventType: event.event_type,
          source: event.source || 'entity_permissions_core',
          payload: event.payload || {},
          context: event.context || {},
          processingStatus: 'skipped'
        });
      }
    } catch (processingError: any) {
      // Record failed processing
      await recordProcessedEvent({
        eventId: event.event_id,
        eventType: event.event_type,
        source: event.source || 'entity_permissions_core',
        payload: event.payload || {},
        context: event.context || {},
        processingStatus: 'failed',
        processingError: processingError.message || String(processingError)
      });

      throw processingError;
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({
      received: true,
      eventId: event.event_id,
      eventType: event.event_type
    });
  } catch (error) {
    logger.error({ error }, 'Failed to process webhook');

    // Return error but don't throw to avoid webhook retries for invalid payloads
    if (error instanceof ApplicationError) {
      res.status(error.statusCode || 400).json({
        error: error.message,
        code: error.code
      });
    } else {
      res.status(500).json({
        error: 'Internal server error processing webhook'
      });
    }
  }
};

/**
 * Handle market approval/rejection decision
 */
async function handleMarketApprovalDecision(event: any): Promise<void> {
  const { payload, context } = event;

  // Validate payload structure
  if (!payload.market_id || !payload.decision) {
    throw new ApplicationError('Invalid approval decision payload', {
      statusCode: 400,
      code: 'invalid_approval_payload'
    });
  }

  // Map decision to our internal format
  const decision: 'approved' | 'rejected' = payload.decision;

  if (decision !== 'approved' && decision !== 'rejected') {
    throw new ApplicationError('Invalid decision value', {
      statusCode: 400,
      code: 'invalid_decision',
      details: { validDecisions: ['approved', 'rejected'] }
    });
  }

  logger.info(
    {
      marketId: payload.market_id,
      decision,
      actorId: context?.actor_id
    },
    'Processing market approval decision'
  );

  // Use the event broker's integration method
  await marketEventBroker.handleEntityPermissionDecision({
    marketId: payload.market_id,
    entityId: payload.entity_id,
    decision,
    actorId: context?.actor_id || 'system',
    reason: payload.reason
  });

  // If approved, the event broker will trigger the marketService to process the approval
  // We need to also call the service directly to handle the actual approval logic
  if (decision === 'approved') {
    // Create a mock admin context from the webhook data
    const adminContext = {
      id: context?.actor_id || 'system',
      roles: ['admin']
    };

    try {
      await marketService.processApprovalDecision(
        {
          marketId: payload.market_id,
          decision: 'approve',
          reason: payload.reason,
          entityId: payload.entity_id
        },
        adminContext
      );

      logger.info({ marketId: payload.market_id }, 'Market approval processed successfully');
    } catch (error) {
      logger.error(
        { error, marketId: payload.market_id },
        'Failed to process approval decision'
      );
      throw error;
    }
  } else {
    // Handle rejection
    const adminContext = {
      id: context?.actor_id || 'system',
      roles: ['admin']
    };

    try {
      await marketService.processApprovalDecision(
        {
          marketId: payload.market_id,
          decision: 'reject',
          reason: payload.reason || 'No reason provided',
          entityId: payload.entity_id
        },
        adminContext
      );

      logger.info({ marketId: payload.market_id }, 'Market rejection processed successfully');
    } catch (error) {
      logger.error(
        { error, marketId: payload.market_id },
        'Failed to process rejection decision'
      );
      throw error;
    }
  }
}

/**
 * Health check for webhook endpoint
 *
 * GET /api/v1/webhooks/health
 */
export const webhookHealthCheck = async (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'webhook-handler',
    timestamp: new Date().toISOString()
  });
};
