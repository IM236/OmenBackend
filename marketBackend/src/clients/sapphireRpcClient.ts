import { fetch } from 'undici';

import { AppConfig } from '@config';
import { logger } from '@infra/logging/logger';
import { ApplicationError } from '@lib/errors';
import { RateLimiter } from '@lib/rateLimiter';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;

export class SapphireRpcClient {
  private readonly rateLimiter: RateLimiter;

  constructor() {
    const perMinute = AppConfig.sapphire.rateLimitPerMinute;
    const refillIntervalMs = Math.max(1000, Math.floor(60_000 / perMinute));
    this.rateLimiter = new RateLimiter(perMinute, refillIntervalMs);
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;
      await this.rateLimiter.acquire();

      try {
        const response = await fetch(AppConfig.sapphire.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: attempt,
            method,
            params
          })
        });

        if (!response.ok) {
          throw new ApplicationError('Sapphire RPC responded with error status', {
            statusCode: response.status,
            code: 'sapphire_rpc_error'
          });
        }

        const data = (await response.json()) as {
          result?: T;
          error?: { code: number; message: string };
        };

        if (data.error) {
          throw new ApplicationError(data.error.message, {
            statusCode: 502,
            code: 'sapphire_rpc_error',
            details: data.error
          });
        }

        if (data.result === undefined) {
          throw new ApplicationError('Missing result from Sapphire RPC', {
            statusCode: 502,
            code: 'sapphire_rpc_error'
          });
        }

        return data.result;
      } catch (error) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, method, error },
          'Sapphire RPC call failed; applying backoff'
        );

        if (attempt >= MAX_ATTEMPTS) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new ApplicationError('Sapphire RPC call failed after retries', {
      statusCode: 502,
      code: 'sapphire_rpc_exhausted'
    });
  }
}

export const sapphireRpcClient = new SapphireRpcClient();
