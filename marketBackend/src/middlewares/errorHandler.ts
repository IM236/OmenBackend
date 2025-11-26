import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof ApplicationError) {
    logger.warn(
      { err, path: req.path, correlationId: res.locals.correlationId },
      'Handled application error'
    );
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  if (err instanceof ZodError) {
    logger.warn(
      { issues: err.issues, path: req.path },
      'Request validation failed'
    );
    return res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: err.issues
      }
    });
  }

  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred'
    }
  });
};
