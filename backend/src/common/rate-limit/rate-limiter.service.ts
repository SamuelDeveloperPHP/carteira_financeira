import { HttpException, Injectable } from "@nestjs/common";
import { RateLimitRepository } from "./rate-limit.repository";

/**
 * Fixed-window rate limiter stored in PostgreSQL, so limits hold across
 * restarts and across several API instances.
 */
@Injectable()
export class RateLimiter {
  constructor(private readonly hits: RateLimitRepository) {}
  /** Counts a hit and answers 429 once `limit` is exceeded within the window. */
  async throttle(key: string, limit: number, seconds = 900) {
    if ((await this.hits.hit(key, seconds)) > limit)
      throw new HttpException(
        "Muitas tentativas. Tente novamente em 15 minutos.",
        429
      );
  }
  /** Same counting, but returns a boolean instead of throwing. */
  async allow(key: string, limit: number, seconds = 900) {
    return (await this.hits.hit(key, seconds)) <= limit;
  }
}
