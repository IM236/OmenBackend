export class ApplicationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'internal_error';
    this.details = options.details;
  }
}
