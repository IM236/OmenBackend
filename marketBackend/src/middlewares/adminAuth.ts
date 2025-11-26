import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

import { AppConfig } from '@config';
import { ApplicationError } from '@lib/errors';

interface AdminClaims extends JwtPayload {
  sub: string;
  roles?: string[];
  permissions?: string[];
}

export const adminAuthMiddleware = (requiredRole?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (apiKey && apiKey === AppConfig.auth.adminApiKey) {
        res.locals.admin = { id: 'api-key-admin', roles: ['admin'] };
        return next();
      }

      const authorization = req.headers.authorization;
      if (authorization && AppConfig.auth.adminJwtPublicKey) {
        const token = authorization.replace(/^Bearer\s+/i, '');
        const claims = jwt.verify(token, AppConfig.auth.adminJwtPublicKey, {
          algorithms: ['RS256', 'ES256', 'HS256']
        }) as AdminClaims;

        if (requiredRole && !claims.roles?.includes(requiredRole)) {
          throw new ApplicationError('Insufficient role privileges', {
            statusCode: 403,
            code: 'forbidden'
          });
        }

        res.locals.admin = {
          id: claims.sub,
          roles: claims.roles ?? [],
          permissions: claims.permissions ?? []
        };

        return next();
      }

      throw new ApplicationError('Admin authentication required', {
        statusCode: 401,
        code: 'unauthorized'
      });
    } catch (error) {
      const status =
        error instanceof ApplicationError ? error.statusCode : 401;
      res.status(status).json({
        error: {
          code: error instanceof ApplicationError ? error.code : 'unauthorized',
          message:
            error instanceof ApplicationError
              ? error.message
              : 'Unable to authenticate request'
        }
      });
    }
  };
};
