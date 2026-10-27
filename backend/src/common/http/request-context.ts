import { randomUUID } from "node:crypto";
import { AppRequest, AuditContext } from "./request.types";

export function auditContext(req: AppRequest): AuditContext {
  return {
    correlationId: req.correlationId || randomUUID(),
    ip: (req.ip || "unknown").slice(0, 80),
    device: String(req.headers?.["user-agent"] || "unknown").slice(0, 500),
    location: req.accessLocation ||
      req.auth?.context?.location || { status: "unavailable" },
  };
}
