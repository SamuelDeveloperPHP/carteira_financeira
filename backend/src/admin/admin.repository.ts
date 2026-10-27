import { Injectable } from "@nestjs/common";
import { Database } from "../common/database/database.service";

/**
 * Consultas SOMENTE de leitura por trás das telas do master. Nenhuma altera
 * dados, e o master não tem rota de escrita em lugar nenhum do sistema.
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly db: Database) {}

  /**
   * Contas com saldo, filtradas por trecho do nome ou do e-mail. O termo vai
   * como parâmetro ($1); `position(... in ...)` busca o trecho sem tratar "%"
   * ou "_" como curingas. Pede uma linha extra para saber se há próxima página.
   */
  async listUsers(search: string, offset: number, limit: number) {
    return (
      await this.db.pool.query(
        `SELECT u.id,u.name,u.email,u.role,u.totp_enabled,u.created_at,w.balance FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE position(lower($1) in lower(u.email))>0 OR position(lower($1) in lower(u.name))>0 ORDER BY u.created_at DESC LIMIT ${limit + 1} OFFSET $2`,
        [search, offset]
      )
    ).rows;
  }

  async findMovement(id: string) {
    return (await this.db.pool.query("SELECT * FROM movements WHERE id=$1", [id]))
      .rows[0];
  }

  /** Lançamentos (partida dobrada) de um movimento: uma linha por carteira afetada. */
  async entriesOf(movementId: string) {
    return (
      await this.db.pool.query(
        "SELECT * FROM entries WHERE movement_id=$1 ORDER BY id",
        [movementId]
      )
    ).rows;
  }

  /** Recusas e falhas dos últimos 15 minutos: base do alerta de "possível ataque ou problema". */
  async failuresLast15Minutes(): Promise<number> {
    return (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM audit_events WHERE outcome<>'success' AND created_at>now()-interval '15 minutes'"
      )
    ).rows[0].total;
  }

  /**
   * Totais do sistema. Os valores monetários voltam como TEXTO (::text) porque
   * somas de bigint podem passar do limite seguro de inteiros do JavaScript.
   * `deposited` é todo o dinheiro que entrou no sistema; como transferências e
   * devoluções só MOVEM dinheiro entre carteiras, a soma dos saldos tem de ser
   * igual a ele. Essa é a conciliação.
   */
  async totals() {
    return (
      await this.db.pool.query(
        "SELECT (SELECT count(*)::int FROM users WHERE role='user') AS users,(SELECT count(*)::int FROM movements) AS movements,(SELECT coalesce(sum(balance),0)::text FROM wallets) AS balance,(SELECT coalesce(sum(amount),0)::text FROM movements WHERE kind='deposit') AS deposited"
      )
    ).rows[0];
  }

  /**
   * Carteiras cujo saldo guardado difere da soma dos próprios lançamentos.
   * O esperado é ZERO; qualquer valor maior indica corrupção ou bug e gera
   * alerta crítico no painel.
   */
  async walletsWithDrift(): Promise<number> {
    return (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM wallets w WHERE w.balance<>coalesce((SELECT sum(e.delta) FROM entries e WHERE e.user_id=w.user_id),0)"
      )
    ).rows[0].total;
  }
}
