import { Injectable } from "@nestjs/common";
import { Queryable } from "../database/database.service";
import { AuditContext } from "../http/request.types";
import { RateLimiter } from "../rate-limit/rate-limiter.service";
import { AuditRepository, Outcome } from "./audit.repository";

/**
 * Escreve a trilha de auditoria (somente inclusão): QUEM fez O QUÊ, QUANDO, DE
 * ONDE e com que RESULTADO. É a base da investigação de incidentes e da tela do
 * master. Nenhum dado sensível entra aqui: nunca senhas, tokens ou códigos.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly events: AuditRepository,
    private readonly limiter: RateLimiter
  ) {}
  // Como a trilha é só de inclusão (não dá para apagar), o "ruído" anônimo
  // (rotas inexistentes, e-mails desconhecidos) dividiria o espaço com eventos
  // importantes e poderia crescer sem limite num ataque. Por isso cada IP tem um
  // ORÇAMENTO (100 eventos a cada 15 min). Eventos ligados a uma conta conhecida
  // ou a um usuário autenticado NUNCA são descartados; só o ruído anônimo é.
  allowAnonymous(ip: string, limit = 100, seconds = 900) {
    return this.limiter.allow(`audit-anon:${ip}`, limit, seconds);
  }
  /**
   * Registra um evento.
   *
   * @param action nome da ação, ex.: "transfer.completed" (cortado em 80 caracteres).
   * @param actor quem fez; null quando não há autor identificado.
   * @param resource sobre o quê (id de usuário, movimento...).
   * @param outcome success, denied (recusa de negócio) ou failure (erro interno).
   * @param client passe a transação aberta para que o evento seja confirmado ou
   *   desfeito JUNTO com a operação que descreve. Sem ele, grava direto: é o caso
   *   das falhas, auditadas depois do rollback (senão o próprio rollback
   *   apagaria a evidência).
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
