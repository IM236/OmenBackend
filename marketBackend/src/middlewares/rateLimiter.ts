import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

interface RateLimitSettings {
  windowMs: number;
  maxRequests: number;
}

export const adminRateLimiter = (settings: RateLimitSettings) =>
  rateLimit({
    windowMs: settings.windowMs,
    max: settings.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) =>
      (req.ip ?? req.headers['x-forwarded-for']?.toString() ?? 'unknown').toString(),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Please try again later.'
        }
      });
    }
  });
