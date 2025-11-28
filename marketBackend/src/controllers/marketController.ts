import { Request, Response } from 'express';
import { MarketService } from '@services/marketService';
import { ApplicationError } from '@lib/errors';
import { AssetType } from '@app-types/market';

/**
 * Market Controller - RWA Registration & Lifecycle
 *
 * Endpoints:
 * 1. POST /markets/register - Issuer registers a new RWA market
 * 2. POST /markets/:id/approve - Admin approves/rejects market
 * 3. POST /markets/:id/activate - Manually trigger activation
 * 4. POST /markets/:id/pause - Pause active market
 * 5. POST /markets/:id/archive - Archive market
 * 6. GET /markets - List markets
 * 7. GET /markets/:id - Get market details
 * 8. GET /markets/:id/events - Get market event history
 */

const marketService = new MarketService();

/**
 * Register a new RWA market
 *
 * POST /api/v1/markets/register
 *
 * Body:
 * {
 *   "name": "Luxury Apartment Building",
 *   "issuerId": "issuer-uuid",
 *   "assetType": "real_estate",
 *   "tokenSymbol": "LUXAPT",
 *   "tokenName": "Luxury Apartment Token",
 *   "totalSupply": 1000000,
 *   "entityId": "entity-uuid",
 *   "assetDetails": {
 *     "valuation": 5000000,
 *     "currency": "USD",
 *     "location": "123 Main St, Los Angeles, CA",
 *     "description": "Premium residential property...",
 *     "complianceDocuments": ["doc-id-1", "doc-id-2"],
 *     "regulatoryInfo": { "jurisdiction": "US", "regulator": "SEC" },
 *     "attributes": { "sqft": 50000, "units": 50 }
 *   },
 *   "metadata": {}
 * }
 */
export const registerMarketHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;

  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  // Validate asset type
  const validAssetTypes: AssetType[] = [
    'real_estate',
    'corporate_stock',
    'government_bond',
    'commodity',
    'private_equity',
    'art_collectible',
    'carbon_credit',
    'other'
  ];

  if (!validAssetTypes.includes(req.body.assetType)) {
    throw new ApplicationError('Invalid asset type', {
      statusCode: 400,
      code: 'invalid_asset_type',
      details: { validTypes: validAssetTypes }
    });
  }

  const result = await marketService.registerMarket(
    {
      name: req.body.name,
      issuerId: req.body.issuerId,
      assetType: req.body.assetType,
      tokenSymbol: req.body.tokenSymbol,
      tokenName: req.body.tokenName,
      totalSupply: req.body.totalSupply,
      entityId: req.body.entityId,
      assetDetails: req.body.assetDetails || {},
      metadata: req.body.metadata || {}
    },
    admin
  );

  res.status(201).json({
    data: {
      market: result.market,
      asset: result.asset
    },
    message: 'Market registered successfully, pending approval'
  });
};

/**
 * Approve or reject a market
 *
 * POST /api/v1/markets/:id/approve
 *
 * Body:
 * {
 *   "decision": "approve" | "reject",
 *   "reason": "Optional rejection reason",
 *   "entityId": "entity-uuid"
 * }
 */
export const approveMarketHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;
  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  const decision = req.body.decision;
  if (!['approve', 'reject'].includes(decision)) {
    throw new ApplicationError('Invalid decision', {
      statusCode: 400,
      code: 'invalid_decision',
      details: { validDecisions: ['approve', 'reject'] }
    });
  }

  const market = await marketService.processApprovalDecision(
    {
      marketId: req.params.id!,
      decision,
      reason: req.body.reason,
      entityId: req.body.entityId
    },
    admin
  );

  res.json({
    data: market,
    message:
      decision === 'approve'
        ? 'Market approved and activation initiated'
        : 'Market rejected'
  });
};

/**
 * Manually activate an approved market
 *
 * POST /api/v1/markets/:id/activate
 *
 * Body:
 * {
 *   "entityId": "entity-uuid"
 * }
 */
export const activateMarketHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;
  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  const market = await marketService.activateMarket(req.params.id, admin);

  res.json({
    data: market,
    message: 'Market activated successfully'
  });
};

/**
 * Pause an active market
 *
 * POST /api/v1/markets/:id/pause
 *
 * Body:
 * {
 *   "entityId": "entity-uuid"
 * }
 */
export const pauseMarketHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;
  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  const market = await marketService.pauseMarket(
    req.params.id,
    req.body.entityId,
    admin
  );

  res.json({
    data: market,
    message: 'Market paused successfully'
  });
};

/**
 * Archive a market
 *
 * POST /api/v1/markets/:id/archive
 *
 * Body:
 * {
 *   "entityId": "entity-uuid"
 * }
 */
export const archiveMarketHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;
  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  const market = await marketService.archiveMarket(
    req.params.id,
    req.body.entityId,
    admin
  );

  res.json({
    data: market,
    message: 'Market archived successfully'
  });
};

/**
 * List markets with filters
 *
 * GET /api/v1/markets?status=active&assetType=real_estate&page=1&pageSize=25
 */
export const listMarketsHandler = async (req: Request, res: Response) => {
  const markets = await marketService.list({
    status: req.query.status as any,
    ownerId: req.query.ownerId as string | undefined,
    createdAfter: req.query.createdAfter
      ? new Date(req.query.createdAfter as string)
      : undefined,
    createdBefore: req.query.createdBefore
      ? new Date(req.query.createdBefore as string)
      : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined
  });

  res.json(markets);
};

/**
 * Get market by ID
 *
 * GET /api/v1/markets/:id
 */
export const getMarketHandler = async (req: Request, res: Response) => {
  const market = await marketService.getById(req.params.id);
  if (!market) {
    throw new ApplicationError('Market not found', {
      statusCode: 404,
      code: 'market_not_found'
    });
  }

  res.json({ data: market });
};

/**
 * Get market with asset details
 *
 * GET /api/v1/markets/:id/details
 */
export const getMarketDetailsHandler = async (req: Request, res: Response) => {
  const result = await marketService.getMarketWithAsset(req.params.id);
  if (!result) {
    throw new ApplicationError('Market not found', {
      statusCode: 404,
      code: 'market_not_found'
    });
  }

  res.json({ data: result });
};

/**
 * Get market event history
 *
 * GET /api/v1/markets/:id/events
 */
export const getMarketEventsHandler = async (req: Request, res: Response) => {
  const events = await marketService.getEventHistory(req.params.id);
  res.json({ data: events });
};
