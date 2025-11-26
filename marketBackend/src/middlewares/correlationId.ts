import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const headerKey = 'x-request-id';
  const incomingCorrelationId =
    (req.headers[headerKey] as string | undefined) ?? randomUUID();

  req.headers[headerKey] = incomingCorrelationId;
  res.setHeader(headerKey, incomingCorrelationId);
  res.locals.correlationId = incomingCorrelationId;

  next();
};
