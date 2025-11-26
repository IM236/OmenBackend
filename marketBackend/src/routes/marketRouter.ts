import { Router } from 'express';
import { z } from 'zod';

import {
  registerMarketHandler,
  approveMarketHandler,
  activateMarketHandler,
  pauseMarketHandler,
  archiveMarketHandler,
  listMarketsHandler,
  getMarketHandler,
  getMarketDetailsHandler,
  getMarketEventsHandler
} from '@controllers/marketController';
import { adminAuthMiddleware } from '@middlewares/adminAuth';
import { validateRequest } from '@middlewares/requestValidation';
import { asyncHandler } from '@lib/asyncHandler';

const registerMarketSchema = {
  body: z.object({
    name: z.string().min(3),
    issuerId: z.string().uuid(),
    assetType: z.enum([
      'real_estate',
      'corporate_stock',
      'government_bond',
      'commodity',
      'private_equity',
      'art_collectible',
      'carbon_credit',
      'other'
    ]),
    tokenSymbol: z.string().min(2).max(10),
    tokenName: z.string().min(3),
    totalSupply: z.number().positive(),
    entityId: z.string().uuid(),
    assetDetails: z.object({
      valuation: z.number().positive().optional(),
      currency: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      complianceDocuments: z.array(z.string()).optional(),
      regulatoryInfo: z.record(z.string(), z.any()).optional(),
      attributes: z.record(z.string(), z.any()).optional()
    }),
    metadata: z.record(z.string(), z.any()).optional()
  })
};

const approveMarketSchema = {
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().optional(),
    entityId: z.string().uuid()
  })
};

const activateMarketSchema = {
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    entityId: z.string().uuid().optional()
  })
};

const pauseMarketSchema = {
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    entityId: z.string().uuid()
  })
};

const archiveMarketSchema = {
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    entityId: z.string().uuid()
  })
};

const listSchema = {
  query: z.object({
    status: z
      .enum([
        'draft',
        'pending_approval',
        'approved',
        'rejected',
        'activating',
        'active',
        'paused',
        'archived'
      ])
      .optional(),
    ownerId: z.string().uuid().optional(),
    createdAfter: z.string().datetime().optional(),
    createdBefore: z.string().datetime().optional(),
    page: z.coerce.number().positive().optional(),
    pageSize: z.coerce.number().positive().max(100).optional()
  })
};

const getSchema = {
  params: z.object({
    id: z.string().uuid()
  })
};

export const marketRouter = Router();

// Register new RWA market
marketRouter.post(
  '/register',
  adminAuthMiddleware('issuer'),
  validateRequest(registerMarketSchema),
  asyncHandler(registerMarketHandler)
);

// Approve or reject market
marketRouter.post(
  '/:id/approve',
  adminAuthMiddleware('admin'),
  validateRequest(approveMarketSchema),
  asyncHandler(approveMarketHandler)
);

// Manually activate market
marketRouter.post(
  '/:id/activate',
  adminAuthMiddleware('admin'),
  validateRequest(activateMarketSchema),
  asyncHandler(activateMarketHandler)
);

// Pause market
marketRouter.post(
  '/:id/pause',
  adminAuthMiddleware('admin'),
  validateRequest(pauseMarketSchema),
  asyncHandler(pauseMarketHandler)
);

// Archive market
marketRouter.post(
  '/:id/archive',
  adminAuthMiddleware('admin'),
  validateRequest(archiveMarketSchema),
  asyncHandler(archiveMarketHandler)
);

// List markets
marketRouter.get('/', validateRequest(listSchema), asyncHandler(listMarketsHandler));

// Get market details with asset info
marketRouter.get(
  '/:id/details',
  validateRequest(getSchema),
  asyncHandler(getMarketDetailsHandler)
);

// Get market event history
marketRouter.get(
  '/:id/events',
  validateRequest(getSchema),
  asyncHandler(getMarketEventsHandler)
);

// Get market by ID
marketRouter.get('/:id', validateRequest(getSchema), asyncHandler(getMarketHandler));
