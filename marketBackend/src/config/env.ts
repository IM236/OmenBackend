import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid boolean value: ${value}`);
  });

const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    REQUEST_TIMEOUT_MS: z.coerce.number().default(15_000),
    DATABASE_URL: z
      .string()
      .default('postgresql://postgres:postgres@localhost:5432/market_backend'),
    DATABASE_SSL: booleanString.optional(),
    DATABASE_POOL_MIN: z.coerce.number().default(2),
    DATABASE_POOL_MAX: z.coerce.number().default(10),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_TLS: booleanString.optional(),
    ENTITY_PERMISSIONS_BASE_URL: z
      .string()
      .default('http://localhost:8000/api/v1'),
    ENTITY_PERMISSIONS_API_KEY: z.string().optional(),
    ENTITY_PERMISSIONS_TIMEOUT_MS: z.coerce.number().default(5_000),
    SAPPHIRE_RPC_URL: z.string().default('https://sapphire.oasis.io'),
    SAPPHIRE_CHAIN_ID: z.string().default('sapphire-localnet'),
    SAPPHIRE_MAX_FEE_CEILING: z.coerce.number().default(100_000_000),
    SAPPHIRE_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
    OASIS_WALLET_MNEMONIC: z.string().default(''),
    CONFIDENTIAL_SIGNER_PRIVATE_KEY: z.string().optional(),
    TRANSACTION_QUEUE_NAME: z.string().default('market-tx-queue'),
    DLQ_QUEUE_NAME: z.string().default('market-tx-dlq'),
    MAX_RETRY_ATTEMPTS: z.coerce.number().default(5),
    RETRY_BACKOFF_MS: z.coerce.number().default(2_000),
    WORKER_CONCURRENCY: z.coerce.number().default(5),
    ADMIN_API_KEY: z.string().optional(),
    ADMIN_JWT_PUBLIC_KEY: z.string().optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
    ENABLE_WEBSOCKETS: booleanString.optional().transform((value) => value ?? true)
  })
  .superRefine((value, ctx) => {
    if (!value.ADMIN_API_KEY && !value.ADMIN_JWT_PUBLIC_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_API_KEY'],
        message:
          'Either ADMIN_API_KEY or ADMIN_JWT_PUBLIC_KEY must be provided for admin authentication.'
      });
    }

    if (!value.OASIS_WALLET_MNEMONIC && !value.CONFIDENTIAL_SIGNER_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OASIS_WALLET_MNEMONIC'],
        message:
          'Provide OASIS_WALLET_MNEMONIC (preferred) or CONFIDENTIAL_SIGNER_PRIVATE_KEY for the Sapphire signer.'
      });
    }
  });

const parsed = EnvironmentSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast to surface missing configuration.
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')}`
  );
}

const env = parsed.data;

export const AppConfig = {
  nodeEnv: env.NODE_ENV,
  server: {
    port: env.PORT,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS
  },
  logging: {
    level: env.LOG_LEVEL
  },
  database: {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ?? false,
    poolMin: env.DATABASE_POOL_MIN,
    poolMax: env.DATABASE_POOL_MAX
  },
  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
    tls: env.REDIS_TLS ?? false
  },
  permissionsService: {
    baseUrl: env.ENTITY_PERMISSIONS_BASE_URL.replace(/\/$/, ''),
    apiKey: env.ENTITY_PERMISSIONS_API_KEY,
    timeoutMs: env.ENTITY_PERMISSIONS_TIMEOUT_MS
  },
  sapphire: {
    rpcUrl: env.SAPPHIRE_RPC_URL,
    chainId: env.SAPPHIRE_CHAIN_ID,
    maxFeeCeiling: env.SAPPHIRE_MAX_FEE_CEILING,
    rateLimitPerMinute: env.SAPPHIRE_RATE_LIMIT_PER_MINUTE,
    mnemonic: env.OASIS_WALLET_MNEMONIC,
    privateKey: env.CONFIDENTIAL_SIGNER_PRIVATE_KEY
  },
  queues: {
    transactionQueue: env.TRANSACTION_QUEUE_NAME,
    deadLetterQueue: env.DLQ_QUEUE_NAME,
    maxRetryAttempts: env.MAX_RETRY_ATTEMPTS,
    retryBackoffMs: env.RETRY_BACKOFF_MS,
    workerConcurrency: env.WORKER_CONCURRENCY
  },
  auth: {
    adminApiKey: env.ADMIN_API_KEY,
    adminJwtPublicKey: env.ADMIN_JWT_PUBLIC_KEY
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS
  },
  features: {
    websockets: env.ENABLE_WEBSOCKETS
  }
} as const;

export type AppConfig = typeof AppConfig;
