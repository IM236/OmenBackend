export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillIntervalMs: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    while (!this.tryConsume()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private tryConsume(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      const refillCount = Math.floor(elapsed / this.refillIntervalMs);
      this.tokens = Math.min(this.maxTokens, this.tokens + refillCount);
      this.lastRefill = now;
    }

    if (this.tokens > 0) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }
}
