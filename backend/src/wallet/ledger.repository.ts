import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import { Movement, NewMovement } from "./wallet.types";

/**
 * SQL de carteiras, movimentos e lançamentos. Movimentos e lançamentos são
 * IMUTÁVEIS: o usuário do banco usado pela API não tem UPDATE/DELETE nelas e
 * gatilhos também recusam. A única coisa que se altera é o saldo da carteira,
 * sempre acompanhado do lançamento que o explica.
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly db: Database) {}

  /**
   * Bloqueia as carteiras (FOR UPDATE) e devolve os saldos em centavos. Enquanto
   * a transação não termina, nenhuma outra consegue alterar essas carteiras: é a
   * base da proteção contra gasto duplo. O ORDER BY garante a MESMA ordem de
   * bloqueio em toda transação, evitando deadlock entre transferências opostas.
   */
  async lockWallets(q: Queryable, ids: string[]): Promise<Map<string, number>> {
    const { rows } = await q.query(
      "SELECT user_id,balance FROM wallets WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    return new Map(rows.map(r => [r.user_id, Number(r.balance)]));
  }
  /** Grava o movimento (a "ordem") e devolve a linha criada. */
  async insertMovement(q: Queryable, m: NewMovement): Promise<Movement> {
    return (
      await q.query(
        "INSERT INTO movements(id,kind,sender_id,recipient_id,amount,original_id,reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [m.id, m.kind, m.senderId, m.recipientId, m.amount, m.originalId, m.reference]
      )
    ).rows[0];
  }
  /**
   * Soma um valor COM SINAL ao saldo (negativo debita, positivo credita) e devolve
   * o novo saldo. A conta é feita pelo banco (`balance+$1`), não lida e regravada
   * pela aplicação, e o CHECK da tabela recusa saldo negativo como última defesa.
   */
  async applyDelta(q: Queryable, userId: string, delta: number) {
    const { rows } = await q.query(
      "UPDATE wallets SET balance=balance+$1 WHERE user_id=$2 RETURNING balance",
      [delta, userId]
    );
    return Number(rows[0].balance);
  }
  /** Grava o lançamento de UMA carteira: o delta e o saldo resultante (base do extrato e da conciliação). */
  async insertEntry(
    q: Queryable,
    movementId: string,
    userId: string,
    delta: number,
    balanceAfter: number
  ) {
    await q.query(
      "INSERT INTO entries(movement_id,user_id,delta,balance_after) VALUES($1,$2,$3,$4)",
      [movementId, userId, delta, balanceAfter]
    );
  }
  /** Busca um movimento pelo id (usado para validar a devolução). */
  async findMovement(q: Queryable, id: string): Promise<Movement | undefined> {
    return (await q.query("SELECT * FROM movements WHERE id=$1", [id])).rows[0];
  }
  /** True se a transferência já foi devolvida (o UNIQUE em original_id também impõe isso no banco). */
  async hasRefund(q: Queryable, originalId: string) {
    const result = await q.query(
      "SELECT id FROM movements WHERE original_id=$1",
      [originalId]
    );
    return (result.rowCount ?? 0) > 0;
  }
  /** Saldo atual de uma carteira (leitura simples, sem bloqueio); undefined se não existir. */
  async balanceOf(userId: string): Promise<number | undefined> {
    const row = (
      await this.db.pool.query("SELECT balance FROM wallets WHERE user_id=$1", [
        userId,
      ])
    ).rows[0];
    return row ? Number(row.balance) : undefined;
  }
  /**
   * Extrato do usuário, do mais novo ao mais antigo, com o nome de quem enviou e
   * de quem recebeu e o vínculo com a devolução (`refund_id`), se houver. Parte
   * dos LANÇAMENTOS (entries), então `delta` e `balance_after` já são do ponto
   * de vista de quem consulta. Pede uma linha extra para saber se há próxima
   * página. `limit` é constante do servidor (nunca entrada do usuário), por isso
   * pode ser interpolado; `offset` e `userId` vão como parâmetros.
   */
  async statement(userId: string, offset: number, limit: number) {
    return (
      await this.db.pool.query(
        `SELECT m.*,e.delta,e.balance_after,s.name AS sender_name,s.email AS sender_email,r.name AS recipient_name,r.email AS recipient_email,rev.id AS refund_id
      FROM entries e JOIN movements m ON m.id=e.movement_id LEFT JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id LEFT JOIN movements rev ON rev.original_id=m.id
      WHERE e.user_id=$1 ORDER BY e.id DESC LIMIT ${limit + 1} OFFSET $2`,
        [userId, offset]
      )
    ).rows;
  }
}
