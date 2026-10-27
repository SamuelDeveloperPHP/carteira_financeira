import { Injectable } from "@nestjs/common";
import { Database } from "../common/database/database.service";

// Read-only queries behind the master's audit screens.
@Injectable()
export class AdminRepository {
  constructor(private readonly db: Database) {}

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
  async entriesOf(movementId: string) {
    return (
      await this.db.pool.query(
        "SELECT * FROM entries WHERE movement_id=$1 ORDER BY id",
        [movementId]
      )
    ).rows;
  }
  async failuresLast15Minutes(): Promise<number> {
    return (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM audit_events WHERE outcome<>'success' AND created_at>now()-interval '15 minutes'"
      )
    ).rows[0].total;
  }
  async totals() {
    return (
      await this.db.pool.query(
        "SELECT (SELECT count(*)::int FROM users WHERE role='user') AS users,(SELECT count(*)::int FROM movements) AS movements,(SELECT coalesce(sum(balance),0)::text FROM wallets) AS balance,(SELECT coalesce(sum(amount),0)::text FROM movements WHERE kind='deposit') AS deposited"
      )
    ).rows[0];
  }
  // Wallets whose stored balance differs from the sum of their ledger entries.
  async walletsWithDrift(): Promise<number> {
    return (
      await this.db.pool.query(
        "SELECT count(*)::int AS total FROM wallets w WHERE w.balance<>coalesce((SELECT sum(e.delta) FROM entries e WHERE e.user_id=w.user_id),0)"
      )
    ).rows[0].total;
  }
}
