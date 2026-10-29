import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../common/audit/audit.repository";
import { AuditService } from "../common/audit/audit.service";
import { EVENTS_PAGE_SIZE, PAGE_SIZE } from "../common/constants";
import { AuditContext } from "../common/http/request.types";
import { WalletService } from "../wallet/wallet.service";
import { EventsQueryDto, UsersQueryDto } from "./dto/admin.dto";
import { AdminRepository } from "./admin.repository";

/**
 * Consultas SOMENTE de leitura do master (auditor).
 *
 * Princípio: quem audita também é auditado. Toda consulta do master (contas,
 * extratos, eventos, movimentações, métricas) é registrada na própria trilha de
 * auditoria, então ninguém inspeciona contas sem deixar rastro. O master não
 * tem nenhuma rota de escrita: não move dinheiro, não altera dados.
 */
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

  async statement(
    id: string,
    q: { page?: number },
    actor: string,
    ctx: AuditContext
  ) {
    await this.audit.record("admin.statement.view", actor, id, ctx, {
      page: q.page ?? 1,
    });
    return this.wallet.statement(id, q.page);
  }

  async searchEvents(q: EventsQueryDto, actor: string, ctx: AuditContext) {
    const page = q.page ?? 1;
    await this.audit.record("admin.events.view", actor, q.userId || null, ctx, {
      filters: { ...q },
    });
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

  /**
   * Rastreio completo de uma movimentação: o registro, os lançamentos de cada
   * carteira afetada e todos os eventos de auditoria relacionados (quem pediu,
   * de que IP, se houve devolução). É o "de ponta a ponta" de uma transferência.
   */
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

  /**
   * Indicadores operacionais e CONCILIAÇÃO.
   *
   * Conciliar é conferir que os números contam a mesma história:
   *   1. a soma de todos os saldos deve ser igual à soma de todos os depósitos
   *      (transferências e devoluções apenas movem dinheiro, não o criam);
   *   2. o saldo de cada carteira deve ser igual à soma dos seus lançamentos.
   * Qualquer diferença gera um alerta CRÍTICO, pois indica corrupção ou bug.
   *
   * Também alerta (nível aviso) quando há 5 ou mais recusas/falhas nos últimos
   * 15 minutos, que pode ser um ataque de tentativa e erro ou um problema.
   */
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
