import type { AdminContext } from './auth';

declare module 'express-serve-static-core' {
  interface Response {
    locals: Record<string, unknown> & {
      admin?: AdminContext;
      correlationId?: string;
    };
  }
}
