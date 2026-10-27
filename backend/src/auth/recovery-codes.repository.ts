import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";

@Injectable()
export class RecoveryCodesRepository {
  // Single use: deleting the row is what spends the code.
  async consume(q: Queryable, userId: string, codeHash: string) {
    const result = await q.query(
      "DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash",
      [userId, codeHash]
    );
    return (result.rowCount ?? 0) > 0;
  }
  async replaceAll(q: Queryable, userId: string, codeHashes: string[]) {
    await this.deleteAll(q, userId);
    for (const hash of codeHashes)
      await q.query("INSERT INTO recovery_codes VALUES($1,$2)", [userId, hash]);
  }
  async deleteAll(q: Queryable, userId: string) {
    await q.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
  }
}
