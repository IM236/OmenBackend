import { Request, Response, NextFunction } from 'express';

export const notFoundHandler = (_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Resource not found'
    }
  });
};
