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
    const body = { message, correlationId: req.correlationId };
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
