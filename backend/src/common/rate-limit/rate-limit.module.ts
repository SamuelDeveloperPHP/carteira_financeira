import { Global, Module } from "@nestjs/common";
import { RateLimitRepository } from "./rate-limit.repository";
import { RateLimiter } from "./rate-limiter.service";

@Global()
@Module({
  providers: [RateLimitRepository, RateLimiter],
  exports: [RateLimiter],
})
export class RateLimitModule {}
