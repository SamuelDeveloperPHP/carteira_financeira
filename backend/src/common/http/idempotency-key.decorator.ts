import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { idempotencyKey } from "../security/validation";

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    idempotencyKey(ctx.switchToHttp().getRequest().headers["idempotency-key"])
);
