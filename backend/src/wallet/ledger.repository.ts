import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import { Movement, NewMovement } from "./wallet.types";

/**
 * SQL for wallets, movements and entries. Movements and entries are append-only:
 * the application role has no UPDATE/DELETE on them, and triggers refuse it too.
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly db: Database) {}

  /**
   * Locks the wallets (FOR UPDATE) and returns their balances in cents. Row
   * locks are taken in a stable order (by id) so two opposite transfers
   * cannot deadlock each other.
   */
  async lockWallets(q: Queryable, ids: string[]): Promise<Map<string, number>> {
    const { rows } = await q.query(
      "SELECT user_id,balance FROM wallets WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    return new Map(rows.map(r => [r.user_id, Number(r.balance)]));
  }
  async insertMovement(q: Queryable, m: NewMovement): Promise<Movement> {
    return (
      await q.query(
        "INSERT INTO movements(id,kind,sender_id,recipient_id,amount,original_id,reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [m.id, m.kind, m.senderId, m.recipientId, m.amount, m.originalId, m.reference]
      )
    ).rows[0];
  }
  /** Adds a signed amount to a wallet and returns the new balance (CHECK blocks negatives). */
  async applyDelta(q: Queryable, userId: string, delta: number) {
    const { rows } = await q.query(
      "UPDATE wallets SET balance=balance+$1 WHERE user_id=$2 RETURNING balance",
      [delta, userId]
    );
    return Number(rows[0].balance);
  }
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
  async findMovement(q: Queryable, id: string): Promise<Movement | undefined> {
    return (await q.query("SELECT * FROM movements WHERE id=$1", [id])).rows[0];
  }
  /** True when the transfer was already reversed (a unique index also enforces it). */
  async hasRefund(q: Queryable, originalId: string) {
    const result = await q.query(
      "SELECT id FROM movements WHERE original_id=$1",
      [originalId]
    );
    return (result.rowCount ?? 0) > 0;
  }
  async balanceOf(userId: string): Promise<number | undefined> {
    const row = (
      await this.db.pool.query("SELECT balance FROM wallets WHERE user_id=$1", [
        userId,
      ])
    ).rows[0];
    return row ? Number(row.balance) : undefined;
  }
  /**
   * A user's entries, newest first, with counterparties and the refund link.
   * Asks for one extra row so the caller can tell whether another page exists.
   * `limit` is a server constant (never user input), hence the interpolation.
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
