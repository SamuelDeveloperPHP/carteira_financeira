import { Global, Module } from "@nestjs/common";
import { RateLimitRepository } from "./rate-limit.repository";
import { RateLimiter } from "./rate-limiter.service";

/**
 * Limite de tentativas. GLOBAL porque o guard, a autenticação, a recuperação de
 * senha e a auditoria o usam. Exporta só o `RateLimiter`; o repositório (SQL) é
 * detalhe interno do módulo.
 */
@Global()
@Module({
  providers: [RateLimitRepository, RateLimiter],
  exports: [RateLimiter],
})
export class RateLimitModule {}
