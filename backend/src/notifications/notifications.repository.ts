import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import { NotificationKind, NotificationRow } from "./notifications.types";

/** SQL da tabela `notifications`. Toda consulta é restrita ao dono (`user_id`). */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Cria o aviso. Recebe a transação aberta para nascer junto com o movimento.
   * `ON CONFLICT DO NOTHING` torna a operação segura se o mesmo par
   * (usuário, movimento) for processado de novo: nunca duplica.
   */
  async insert(
    q: Queryable,
    n: {
      id: string;
      userId: string;
      kind: NotificationKind;
      movementId: string;
    }
  ) {
    await q.query(
      "INSERT INTO notifications(id,user_id,kind,movement_id) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,movement_id) DO NOTHING",
      [n.id, n.userId, n.kind, n.movementId]
    );
  }

  /**
   * Não lidas, da mais nova para a mais antiga. Em qualquer movimento, quem
   * ENVIOU o dinheiro é sempre `m.sender_id`: na transferência é quem pagou; na
   * devolução é quem devolveu. Por isso uma única junção atende os dois tipos.
   * Pede uma linha extra para saber se existe próxima página.
   */
  async listUnread(
    userId: string,
    offset: number,
    limit: number
  ): Promise<NotificationRow[]> {
    return (
      await this.db.pool.query(
        `SELECT n.id,n.kind,n.movement_id,n.created_at,m.amount,s.name AS counterpart_name
         FROM notifications n
         JOIN movements m ON m.id=n.movement_id
         LEFT JOIN users s ON s.id=m.sender_id
         WHERE n.user_id=$1 AND n.read_at IS NULL
         ORDER BY n.created_at DESC, n.id
         LIMIT ${limit + 1} OFFSET $2`,
        [userId, offset]
      )
    ).rows;
  }

  /** Quantas não lidas: alimenta o contador do sino. Usa o índice parcial. */
  async countUnread(userId: string): Promise<number> {
    return (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM notifications WHERE user_id=$1 AND read_at IS NULL",
        [userId]
      )
    ).rows[0].total;
  }

  /**
   * Marca como lida. Filtra por `user_id`: ninguém lê (nem descobre) a
   * notificação de outra pessoa. `coalesce` preserva a data da primeira leitura
   * se o pedido for repetido. Devolve false se não existir para este usuário.
   */
  async markRead(userId: string, id: string): Promise<boolean> {
    const result = await this.db.pool.query(
      "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2",
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Marca todas as pendentes do usuário e devolve quantas mudaram. */
  async markAllRead(userId: string): Promise<number> {
    const result = await this.db.pool.query(
      "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",
      [userId]
    );
    return result.rowCount ?? 0;
  }
}
