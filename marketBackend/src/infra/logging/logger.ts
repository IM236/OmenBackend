import pino from 'pino';
import pinoHttp from 'pino-http';

import { AppConfig } from '@config';

export const logger = pino({
  level: AppConfig.logging.level,
  base: undefined,
  transport:
    AppConfig.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:standard',
            colorize: true,
            ignore: 'pid,hostname'
          }
        }
      : undefined
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: true,
  customProps: (req) => ({
    correlationId: req.headers['x-request-id'],
    route: req.route?.path
  })
});
