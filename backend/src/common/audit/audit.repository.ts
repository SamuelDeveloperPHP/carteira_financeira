import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../database/database.service";

/** success = fez; denied = recusado por regra de negócio (4xx); failure = erro interno (5xx). */
export type Outcome = "success" | "denied" | "failure";

/** Uma linha da trilha de auditoria, já normalizada pelo AuditService. */
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

/** Filtros da tela de eventos do master. Todos opcionais e combináveis (AND). */
export interface AuditFilters {
  userId?: string;
  action?: string;
  outcome?: Outcome;
  ip?: string;
  from?: string;
  to?: string;
}

/**
 * Acesso SQL à tabela `audit_events` (somente inclusão e leitura: a conexão da
 * API não tem UPDATE/DELETE nela).
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava um evento. Quando recebe `q` (a transação aberta), o evento é
   * confirmado ou desfeito junto com a operação que descreve. Sem `q`, grava
   * direto no pool; é o caso das falhas, auditadas DEPOIS do rollback.
   */
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

  /**
   * Busca paginada para o master. O SQL é montado dinamicamente, mas só com
   * PARÂMETROS ($1, $2...): o texto do usuário nunca é concatenado na consulta,
   * o que elimina injeção de SQL. `limit` é uma constante do servidor.
   */
  async search(filters: AuditFilters, offset: number, limit: number) {
    const values: unknown[] = [];
    const where: string[] = [];
    // Registra o valor e devolve o próximo marcador numerado ($1, $2...).
    const add = (value: unknown, sql: (p: string) => string) => {
      values.push(value);
      where.push(sql(`$${values.length}`));
    };
    // "Eventos deste usuário" inclui: o que ele fez (actor), o que foi feito
    // sobre ele (resource) e qualquer evento de movimento em que ele participou.
    // Assim o master investiga uma conta de ponta a ponta.
    if (filters.userId)
      add(
        filters.userId,
        p =>
          `(a.actor_id=${p}::uuid OR a.resource=${p}::text OR a.resource IN (SELECT id::text FROM movements WHERE sender_id=${p}::uuid OR recipient_id=${p}::uuid))`
      );
    // Busca por trecho do nome da ação (ex.: "login" acha auth.login e auth.login.failed).
    // position() em vez de LIKE: evita tratar % e _ digitados como curingas.
    if (filters.action)
      add(filters.action, p => `position(${p} in a.action)>0`);
    if (filters.outcome) add(filters.outcome, p => `a.outcome=${p}`);
    if (filters.ip) add(filters.ip, p => `a.ip=${p}`);
    // Datas são normalizadas para ISO antes de ir ao banco.
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
    // Pede uma linha a mais que o limite: se vier, existe próxima página (evita COUNT).
    const { rows } = await this.db.pool.query(
      `SELECT a.*,u.name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT ${limit + 1} OFFSET $${values.length}`,
      values
    );
    return rows;
  }

  /**
   * Linha do tempo de uma movimentação: eventos sobre ela e também eventos de
   * uma devolução que aponta para ela (`details.originalId`).
   */
  async forMovement(movementId: string) {
    return (
      await this.db.pool.query(
        `SELECT * FROM audit_events WHERE resource=$1 OR details->>'originalId'=$1 ORDER BY created_at,id`,
        [movementId]
      )
    ).rows;
  }
}
