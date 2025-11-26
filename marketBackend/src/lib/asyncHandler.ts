import { NextFunction, Request, Response, RequestHandler } from 'express';

export const asyncHandler =
  <Params = any, ResBody = any, ReqBody = any, ReqQuery = any>(
    handler: (
      req: Request<Params, ResBody, ReqBody, ReqQuery>,
      res: Response<ResBody>,
      next: NextFunction
    ) => Promise<unknown> | unknown
  ): RequestHandler<Params, ResBody, ReqBody, ReqQuery> =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
