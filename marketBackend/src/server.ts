import { AppConfig } from '@config';
import { app } from './app';
import { bootstrapInfrastructure, shutdownInfrastructure } from '@infra/bootstrap';
import { logger } from '@infra/logging/logger';

const start = async () => {
  try {
    await bootstrapInfrastructure();
    const server = app.listen(AppConfig.server.port, () => {
      logger.info(
        { port: AppConfig.server.port, env: AppConfig.nodeEnv },
        'HTTP server started'
      );
    });

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ signal }, 'Received shutdown signal');
      server.close(async (closeError) => {
        if (closeError) {
          logger.error(closeError, 'Error during server close');
        }

        try {
          await shutdownInfrastructure();
        } catch (infraError) {
          logger.error(infraError, 'Infrastructure shutdown failed');
        } finally {
          process.exit(closeError ? 1 : 0);
        }
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error(error, 'Failed to start the service');
    process.exit(1);
  }
};

void start();
