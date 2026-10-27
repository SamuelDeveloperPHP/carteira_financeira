import { Injectable } from "@nestjs/common";
import { Queryable } from "../database/database.service";
import { AuditContext } from "../http/request.types";
import { RateLimiter } from "../rate-limit/rate-limiter.service";
import { AuditRepository, Outcome } from "./audit.repository";

/** Writes the append-only audit trail: who did what, from where, with what result. */
@Injectable()
export class AuditService {
  constructor(
    private readonly events: AuditRepository,
    private readonly limiter: RateLimiter
  ) {}
  // Unauthenticated noise (random paths, unknown e-mails) shares a per-IP budget so
  // it cannot grow the append-only trail without bound. Events tied to a known
  // account or an authenticated user are never dropped.
  allowAnonymous(ip: string, limit = 100, seconds = 900) {
    return this.limiter.allow(`audit-anon:${ip}`, limit, seconds);
  }
  /**
   * @param client pass the open transaction so the audit row commits or rolls
   *   back together with the operation it describes.
   */
  async record(
    action: string,
    actor: string | null,
    resource: string | null,
    ctx: AuditContext,
    details: Record<string, unknown> = {},
    outcome: Outcome = "success",
    reason: string | null = null,
    client?: Queryable
  ) {
    await this.events.insert(
      {
        actorId: actor,
        action: action.slice(0, 80),
        resource,
        outcome,
        reason: reason?.slice(0, 160) || null,
        correlationId: ctx.correlationId,
        ip: ctx.ip,
        device: ctx.device,
        location: ctx.location || { status: "unavailable" },
        details,
      },
      client
    );
  }
}
