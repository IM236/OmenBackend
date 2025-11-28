import { Router } from 'express';
import { asyncHandler } from '@lib/asyncHandler';
import {
  handleEntityPermissionsWebhook,
  webhookHealthCheck
} from '@controllers/webhookController';

const router = Router();

/**
 * Webhook Routes
 *
 * These endpoints receive events from external services like
 * Entity Permissions Core and Sapphire blockchain.
 */

/**
 * Health check for webhook service
 * GET /api/v1/webhooks/health
 */
router.get('/health', asyncHandler(webhookHealthCheck));

/**
 * Receive events from Entity Permissions Core
 * POST /api/v1/webhooks/entity-permissions
 *
 * This endpoint receives SNS notifications or direct HTTP webhooks
 * containing approval/rejection decisions for markets.
 *
 * No authentication required - webhook signature validation happens inside the handler
 */
router.post('/entity-permissions', asyncHandler(handleEntityPermissionsWebhook));

/**
 * TODO: Add webhook for Sapphire blockchain events
 * POST /api/v1/webhooks/sapphire
 *
 * This would receive on-chain events like:
 * - Token transfers
 * - Market contract deployments
 * - Settlement confirmations
 */
// router.post('/sapphire', asyncHandler(handleSapphireWebhook));

export default router;
