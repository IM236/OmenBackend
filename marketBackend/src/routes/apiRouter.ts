import { Router } from 'express';

import { healthRouter } from '@routes/healthRouter';
import { marketRouter } from '@routes/marketRouter';
import { tokenRouter } from '@routes/tokenRouter';
import { tradingRouter } from '@routes/tradingRouter';
import webhookRouter from '@routes/webhookRouter';
import { wrapperRouter } from '@routes/wrapperRouter';
import { swapRouter } from '@routes/swapRouter';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/markets', marketRouter);
apiRouter.use('/tokens', tokenRouter);
apiRouter.use('/trading', tradingRouter);
apiRouter.use('/webhooks', webhookRouter);
apiRouter.use('/wrapper', wrapperRouter);
apiRouter.use('/swaps', swapRouter);
