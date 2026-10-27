import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Database } from "./db";

@Injectable()
export class Audit {
  constructor(private readonly db: Database) {}
  // Unauthenticated noise (random paths, unknown e-mails) shares a per-IP budget so
  // it cannot grow the append-only trail without bound. Events tied to a known
  // account or an authenticated user are never dropped.
  async allowAnonymous(ip: string, limit = 100, seconds = 900) {
    const { rows } = await this.db.pool.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [createHash("sha256").update(`audit-anon:${ip}`).digest("hex"), seconds]
    );
    return rows[0].count <= limit;
  }
  async record(
    action: string,
    actor: string | null,
    resource: string | null,
    ctx: any,
    details: Record<string, unknown> = {},
    outcome = "success",
    reason: string | null = null,
    client: any = this.db.pool
  ) {
    await client.query(
      `INSERT INTO audit_events(actor_id,action,resource,outcome,reason,correlation_id,ip,device,location,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        actor,
        action.slice(0, 80),
        resource,
        outcome,
        reason?.slice(0, 160) || null,
        ctx.correlationId,
        ctx.ip,
        ctx.device,
        ctx.location || { status: "unavailable" },
        details,
      ]
    );
  }
}
