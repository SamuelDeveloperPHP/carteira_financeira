import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";

@Injectable()
export class PasswordResetsRepository {
  // One live token per user: issuing a new one invalidates the previous.
  async issue(q: Queryable, userId: string, tokenHash: string, minutes: number) {
    await q.query(
      "DELETE FROM password_resets WHERE user_id=$1 OR expires_at<now()",
      [userId]
    );
    await q.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3*interval '1 minute'))",
      [tokenHash, userId, minutes]
    );
  }
  // DELETE ... RETURNING makes the token single-use even under concurrency.
  async consume(q: Queryable, tokenHash: string): Promise<string | undefined> {
    return (
      await q.query(
        "DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
        [tokenHash]
      )
    ).rows[0]?.user_id;
  }
  async deleteForUser(q: Queryable, userId: string) {
    await q.query("DELETE FROM password_resets WHERE user_id=$1", [userId]);
  }
}
