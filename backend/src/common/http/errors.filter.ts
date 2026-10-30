import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";
import { AuditService } from "../audit/audit.service";
import { auditContext } from "./request-context";
import { AppRequest } from "./request.types";

/**
 * Última barreira: TODA exceção da aplicação termina aqui. É o tratamento
 * central de erros do backend (um único `catch` para todas as rotas).
 *
 * Regras:
 *   - recusas de negócio (HttpException: saldo insuficiente, 404, 403...) mantêm
 *     a própria mensagem, que é segura e em português;
 *   - qualquer outro erro (bug, banco fora do ar) vira um 500 GENÉRICO: detalhes
 *     internos, SQL e stack trace nunca chegam ao cliente;
 *   - cada falha é auditada DEPOIS do rollback da transação, para a evidência
 *     sobreviver;
 *   - se a própria auditoria falhar, a resposta ao usuário sai mesmo assim.
 *
 * A resposta traz o `correlationId`, que liga o erro à linha de log e ao evento
 * de auditoria da mesma requisição.
 */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  constructor(private readonly audit: AuditService) {}
  async catch(error: any, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>(),
      res = http.getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message =
      error instanceof HttpException
        ? error.message
        : "Não foi possível concluir. Tente novamente usando a mesma solicitação.";
    const actor = req.auth?.user_id || req.actorId || null;
    // Código estável (opcional) para o cliente decidir sem ler o texto da mensagem.
    const response =
      error instanceof HttpException ? error.getResponse() : null;
    const code =
      response && typeof response === "object"
        ? (response as { code?: string }).code
        : undefined;
    const body = {
      message,
      ...(code ? { code } : {}),
      correlationId: req.correlationId,
    };
    try {
      if (
        !actor &&
        !req.targetResource &&
        !(await this.audit.allowAnonymous(auditContext(req).ip))
      ) {
        console.log(
          JSON.stringify({
            event: "audit.suppressed",
            correlationId: req.correlationId,
            status,
          })
        );
        res.status(status).json(body);
        return;
      }
      await this.audit.record(
        `${req.method} ${req.path}`,
        actor,
        req.targetResource || null,
        auditContext(req),
        {},
        status < 500 ? "denied" : "failure",
        status < 500 ? message : "internal_error"
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "audit.write.failed",
          correlationId: req.correlationId,
        })
      );
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request.failed",
          correlationId: req.correlationId,
          errorType: error?.constructor?.name,
          code: error?.code,
        })
      );
    res.status(status).json(body);
  }
}
