import { Injectable } from "@nestjs/common";
import { Database } from "./db";

@Injectable()
export class Audit {
  constructor(private readonly db: Database) {}
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
