import express from 'express';

import { AppConfig } from '@config';
import { httpLogger } from '@infra/logging/logger';
import { adminRateLimiter } from '@middlewares/rateLimiter';
import { correlationIdMiddleware } from '@middlewares/correlationId';
import { errorHandler } from '@middlewares/errorHandler';
import { notFoundHandler } from '@middlewares/notFound';
import { apiRouter } from '@routes/apiRouter';

const app = express();

app.disable('x-powered-by');
app.use(correlationIdMiddleware);
app.use(httpLogger);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(adminRateLimiter(AppConfig.rateLimit));

app.use('/api/v1', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
