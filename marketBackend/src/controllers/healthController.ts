import { Request, Response } from 'express';

import { AppConfig } from '@config';

export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    env: AppConfig.nodeEnv,
    version: '0.1.0'
  });
};
