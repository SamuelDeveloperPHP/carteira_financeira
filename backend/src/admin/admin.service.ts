import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../common/audit/audit.repository";
import { AuditService } from "../common/audit/audit.service";
import { EVENTS_PAGE_SIZE, PAGE_SIZE } from "../common/constants";
import { AuditContext } from "../common/http/request.types";
import { WalletService } from "../wallet/wallet.service";
import { EventsQueryDto, UsersQueryDto } from "./dto/admin.dto";
import { AdminRepository } from "./admin.repository";

// Every read the master makes is itself written to the audit trail.
@Injectable()
export class AdminService {
  constructor(
    private readonly admin: AdminRepository,
    private readonly events: AuditRepository,
    private readonly audit: AuditService,
    private readonly wallet: WalletService
  ) {}

  async users(q: UsersQueryDto, actor: string, ctx: AuditContext) {
    const page = q.page ?? 1,
      search = q.email ?? "";
    await this.audit.record("admin.accounts.view", actor, null, ctx, {
      search,
      page,
    });
    const rows = await this.admin.listUsers(
      search,
      (page - 1) * PAGE_SIZE,
      PAGE_SIZE
    );
    return {
      items: rows.slice(0, PAGE_SIZE),
      page,
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  async statement(id: string, q: { page?: number }, actor: string, ctx: AuditContext) {
    await this.audit.record("admin.statement.view", actor, id, ctx, {
      page: q.page ?? 1,
    });
    return this.wallet.statement(id, q.page);
  }

  async searchEvents(q: EventsQueryDto, actor: string, ctx: AuditContext) {
    const page = q.page ?? 1;
    await this.audit.record(
      "admin.events.view",
      actor,
      q.userId || null,
      ctx,
      { filters: { ...q } }
    );
    const rows = await this.events.search(
      {
        userId: q.userId,
        action: q.action,
        outcome: q.outcome,
        ip: q.ip,
        from: q.from,
        to: q.to,
      },
      (page - 1) * EVENTS_PAGE_SIZE,
      EVENTS_PAGE_SIZE
    );
    return {
      items: rows.slice(0, EVENTS_PAGE_SIZE),
      page,
      hasMore: rows.length > EVENTS_PAGE_SIZE,
    };
  }

  async movement(id: string, actor: string, ctx: AuditContext) {
    const movement = await this.admin.findMovement(id);
    if (!movement) throw new NotFoundException("Movimentação não encontrada.");
    await this.audit.record("admin.movement.view", actor, id, ctx);
    const [events, entries] = await Promise.all([
      this.events.forMovement(id),
      this.admin.entriesOf(id),
    ]);
    return { movement, entries, events };
  }

  async metrics(actor: string, ctx: AuditContext) {
    await this.audit.record("admin.metrics.view", actor, null, ctx);
    const failures = await this.admin.failuresLast15Minutes();
    const totals = await this.admin.totals();
    const drift = await this.admin.walletsWithDrift();
    const unbalanced = drift > 0 || totals.balance !== totals.deposited;
    return {
      database: "healthy",
      uptimeSeconds: Math.floor(process.uptime()),
      ...totals,
      failuresLast15Minutes: failures,
      reconciliation: {
        mismatchedWallets: drift,
        balanced: !unbalanced,
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
        ...(unbalanced
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
