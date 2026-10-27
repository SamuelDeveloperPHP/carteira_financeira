import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import { AppRequest } from "./request.types";

/**
 * Middleware do Express que roda em TODA requisição.
 *
 *   1. Gera um ID de correlação (UUID) e o devolve no cabeçalho X-Request-Id. O
 *      mesmo ID vai para os eventos de auditoria e para o log, então dá para
 *      seguir uma requisição de ponta a ponta quando algo dá errado.
 *   2. Marca a resposta como `no-store`: saldo e extrato não ficam em cache do
 *      navegador nem de proxies.
 *   3. Ao terminar, escreve UMA linha de log em JSON (método, rota, status,
 *      duração). Nunca registra corpo, cabeçalhos de cookie nem segredos.
 *
 * O /api/health fica de fora do log: o Docker o chama a cada poucos segundos e
 * só geraria ruído.
 */
export function requestLogger(
  req: AppRequest,
  res: Response,
  next: NextFunction
) {
  req.correlationId = randomUUID();
  res.setHeader("X-Request-Id", req.correlationId);
  res.setHeader("Cache-Control", "no-store");
  const start = Date.now();
  res.on("finish", () => {
    if (req.path !== "/api/health")
      console.log(
        JSON.stringify({
          event: "http.request",
          correlationId: req.correlationId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        })
      );
  });
  next();
}
