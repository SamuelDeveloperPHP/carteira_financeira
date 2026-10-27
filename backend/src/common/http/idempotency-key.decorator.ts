import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { idempotencyKey } from "../security/validation";

/**
 * Decorador de parâmetro: `@IdempotencyKey() key: string` entrega a chave do
 * cabeçalho `Idempotency-Key` já validada (8 a 100 caracteres seguros).
 * Se o cabeçalho faltar ou for inválido, a rota responde 400 antes de qualquer
 * regra de negócio: operação que move dinheiro sem chave não é aceita.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    idempotencyKey(ctx.switchToHttp().getRequest().headers["idempotency-key"])
);
