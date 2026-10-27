import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import {
  AuditContext,
  SessionStage,
  SessionUser,
} from "../common/http/request.types";

export interface NewSession {
  tokenHash: string;
  userId: string;
  stage: SessionStage;
  minutes: number;
  context: Partial<AuditContext>;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  stage: SessionStage;
  context: Partial<AuditContext>;
}

/** Server-side sessions keyed by the SHA-256 of the cookie token. */
@Injectable()
export class SessionsRepository {
  constructor(private readonly db: Database) {}
  /** Expiry is computed by the database clock, not the application's. */
  async create(q: Queryable, s: NewSession) {
    await q.query(
      "INSERT INTO sessions(token_hash,user_id,stage,expires_at,context) VALUES($1,$2,$3,now()+($4*interval '1 minute'),$5)",
      [s.tokenHash, s.userId, s.stage, s.minutes, s.context]
    );
  }
  async findActiveWithUser(tokenHash: string): Promise<SessionUser | undefined> {
    return (
      await this.db.pool.query(
        `SELECT s.*,u.name,u.email,u.role,u.totp_enabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()`,
        [tokenHash]
      )
    ).rows[0];
  }
  /** Locks the session row so two concurrent 2FA attempts cannot both finish the login. */
  async lockActive(
    q: Queryable,
    tokenHash: string
  ): Promise<SessionRow | undefined> {
    return (
      await q.query(
        "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
        [tokenHash]
      )
    ).rows[0];
  }
  async delete(q: Queryable, tokenHash: string) {
    await q.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash]);
  }
  async deleteByUser(q: Queryable, userId: string) {
    await q.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  }
  // A new password login replaces any half-finished 2FA session and prunes expired ones.
  async deleteIncomplete(q: Queryable, userId: string) {
    await q.query(
      "DELETE FROM sessions WHERE user_id=$1 AND (stage<>'full' OR expires_at<now())",
      [userId]
    );
  }
  // Keeps only the newest `keep` complete sessions; older ones are revoked.
  async trimFull(q: Queryable, userId: string, keep: number) {
    await q.query(
      "DELETE FROM sessions WHERE user_id=$1 AND stage='full' AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=$1 AND stage='full' ORDER BY created_at DESC, token_hash LIMIT $2)",
      [userId, keep]
    );
  }
}
