import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Database } from "./db";
import { Audit } from "./audit";
import { Wallet } from "./wallet";
import * as S from "./security";

@Injectable()
export class Admin {
  constructor(
    private readonly db: Database,
    private readonly audit: Audit,
    private readonly wallet: Wallet
  ) {}
  async users(q: any, req: any) {
    S.object(q, ["email", "page"]);
    const page = S.page(q.page),
      search = q.email ? S.text(q.email, 1, 254) : "";
    await this.audit.record(
      "admin.accounts.view",
      req.auth.user_id,
      null,
      S.context(req),
      { search, page }
    );
    const { rows } = await this.db.pool.query(
      `SELECT u.id,u.name,u.email,u.role,u.totp_enabled,u.created_at,w.balance FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE position(lower($1) in lower(u.email))>0 OR position(lower($1) in lower(u.name))>0 ORDER BY u.created_at DESC LIMIT 21 OFFSET $2`,
      [search, (page - 1) * 20]
    );
    return { items: rows.slice(0, 20), page, hasMore: rows.length > 20 };
  }
  async statement(id: string, q: any, req: any) {
    S.uuid(id);
    S.object(q, ["page"]);
    await this.audit.record(
      "admin.statement.view",
      req.auth.user_id,
      id,
      S.context(req),
      { page: S.page(q.page) }
    );
    return this.wallet.statement(id, q.page);
  }
  async events(q: any, req: any) {
    S.object(q, ["userId", "action", "outcome", "ip", "from", "to", "page"]);
    const values: any[] = [];
    const where: string[] = [];
    const add = (value: any, sql: (p: string) => string) => {
      values.push(value);
      where.push(sql(`$${values.length}`));
    };
    if (q.userId)
      add(
        S.uuid(q.userId),
        p =>
          `(a.actor_id=${p}::uuid OR a.resource=${p}::text OR a.resource IN (SELECT id::text FROM movements WHERE sender_id=${p}::uuid OR recipient_id=${p}::uuid))`
      );
    if (q.action)
      add(S.text(q.action, 1, 80), p => `position(${p} in a.action)>0`);
    if (q.outcome) {
      if (!["success", "denied", "failure"].includes(q.outcome))
        throw new BadRequestException("Resultado inválido.");
      add(q.outcome, p => `a.outcome=${p}`);
    }
    if (q.ip) add(S.text(q.ip, 1, 80), p => `a.ip=${p}`);
    for (const field of ["from", "to"])
      if (q[field]) {
        if (
          typeof q[field] !== "string" ||
          !Number.isFinite(Date.parse(q[field]))
        )
          throw new BadRequestException("Data inválida.");
        add(
          new Date(q[field]).toISOString(),
          p =>
            `a.created_at ${field === "from" ? ">=" : "<="} ${p}::timestamptz`
        );
      }
    const page = S.page(q.page);
    values.push((page - 1) * 30);
    await this.audit.record(
      "admin.events.view",
      req.auth.user_id,
      q.userId || null,
      S.context(req),
      { filters: q }
    );
    const { rows } = await this.db.pool.query(
      `SELECT a.*,u.name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT 31 OFFSET $${values.length}`,
      values
    );
    return { items: rows.slice(0, 30), page, hasMore: rows.length > 30 };
  }
  async movement(id: string, req: any) {
    S.uuid(id);
    const movement = (
      await this.db.pool.query("SELECT * FROM movements WHERE id=$1", [id])
    ).rows[0];
    if (!movement) throw new NotFoundException("Movimentação não encontrada.");
    await this.audit.record(
      "admin.movement.view",
      req.auth.user_id,
      id,
      S.context(req)
    );
    const events = (
      await this.db.pool.query(
        `SELECT * FROM audit_events WHERE resource=$1 OR details->>'originalId'=$1 ORDER BY created_at,id`,
        [id]
      )
    ).rows;
    const entries = (
      await this.db.pool.query(
        "SELECT * FROM entries WHERE movement_id=$1 ORDER BY id",
        [id]
      )
    ).rows;
    return { movement, entries, events };
  }
  async metrics(req: any) {
    await this.audit.record(
      "admin.metrics.view",
      req.auth.user_id,
      null,
      S.context(req)
    );
    const failures = (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM audit_events WHERE outcome<>'success' AND created_at>now()-interval '15 minutes'"
      )
    ).rows[0].total;
    const totals = (
      await this.db.pool.query(
        "SELECT (SELECT count(*)::int FROM users WHERE role='user') AS users,(SELECT count(*)::int FROM movements) AS movements,(SELECT coalesce(sum(balance),0)::text FROM wallets) AS balance,(SELECT coalesce(sum(amount),0)::text FROM movements WHERE kind='deposit') AS deposited"
      )
    ).rows[0];
    const drift = (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM wallets w WHERE w.balance<>coalesce((SELECT sum(e.delta) FROM entries e WHERE e.user_id=w.user_id),0)"
      )
    ).rows[0].total;
    return {
      database: "healthy",
      uptimeSeconds: Math.floor(process.uptime()),
      ...totals,
      failuresLast15Minutes: failures,
      reconciliation: {
        mismatchedWallets: drift,
        balanced: drift === 0 && totals.balance === totals.deposited,
      },
      alerts: [
        ...(failures >= 5
          ? [
              {
                level: "warning",
                message: "Cinco ou mais recusas/falhas nos últimos 15 minutos.",
              },
            ]
          : []),
        ...(drift || totals.balance !== totals.deposited
          ? [
              {
                level: "critical",
                message:
                  "Divergência na conciliação. Investigue as movimentações.",
              },
            ]
          : []),
      ],
    };
  }
}
