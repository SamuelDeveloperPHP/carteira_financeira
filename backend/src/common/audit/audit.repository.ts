import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../database/database.service";

export type Outcome = "success" | "denied" | "failure";

export interface AuditRecord {
  actorId: string | null;
  action: string;
  resource: string | null;
  outcome: Outcome;
  reason: string | null;
  correlationId: string;
  ip: string;
  device: string;
  location: unknown;
  details: Record<string, unknown>;
}

export interface AuditFilters {
  userId?: string;
  action?: string;
  outcome?: Outcome;
  ip?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly db: Database) {}
  async insert(e: AuditRecord, q: Queryable = this.db.pool) {
    await q.query(
      `INSERT INTO audit_events(actor_id,action,resource,outcome,reason,correlation_id,ip,device,location,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.actorId,
        e.action,
        e.resource,
        e.outcome,
        e.reason,
        e.correlationId,
        e.ip,
        e.device,
        e.location,
        e.details,
      ]
    );
  }
  async search(filters: AuditFilters, offset: number, limit: number) {
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown, sql: (p: string) => string) => {
      values.push(value);
      where.push(sql(`$${values.length}`));
    };
    if (filters.userId)
      add(
        filters.userId,
        p =>
          `(a.actor_id=${p}::uuid OR a.resource=${p}::text OR a.resource IN (SELECT id::text FROM movements WHERE sender_id=${p}::uuid OR recipient_id=${p}::uuid))`
      );
    if (filters.action)
      add(filters.action, p => `position(${p} in a.action)>0`);
    if (filters.outcome) add(filters.outcome, p => `a.outcome=${p}`);
    if (filters.ip) add(filters.ip, p => `a.ip=${p}`);
    if (filters.from)
      add(
        new Date(filters.from).toISOString(),
        p => `a.created_at >= ${p}::timestamptz`
      );
    if (filters.to)
      add(
        new Date(filters.to).toISOString(),
        p => `a.created_at <= ${p}::timestamptz`
      );
    values.push(offset);
    const { rows } = await this.db.pool.query(
      `SELECT a.*,u.name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT ${limit + 1} OFFSET $${values.length}`,
      values
    );
    return rows;
  }
  async forMovement(movementId: string) {
    return (
      await this.db.pool.query(
        `SELECT * FROM audit_events WHERE resource=$1 OR details->>'originalId'=$1 ORDER BY created_at,id`,
        [movementId]
      )
    ).rows;
  }
}
