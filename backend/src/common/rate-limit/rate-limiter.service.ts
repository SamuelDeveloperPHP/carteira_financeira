import { HttpException, Injectable } from "@nestjs/common";
import { RateLimitRepository } from "./rate-limit.repository";

@Injectable()
export class RateLimiter {
  constructor(private readonly hits: RateLimitRepository) {}
  async throttle(key: string, limit: number, seconds = 900) {
    if ((await this.hits.hit(key, seconds)) > limit)
      throw new HttpException(
        "Muitas tentativas. Tente novamente em 15 minutos.",
        429
      );
  }
  async allow(key: string, limit: number, seconds = 900) {
    return (await this.hits.hit(key, seconds)) <= limit;
  }
}
