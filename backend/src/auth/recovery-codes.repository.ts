import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";

/** SQL dos códigos de recuperação do 2FA (tabela `recovery_codes`). Só hashes ficam no banco. */
@Injectable()
export class RecoveryCodesRepository {
  /**
   * Gasta um código: apagar a linha É o ato de usar. O DELETE ... RETURNING é
   * atômico, então o mesmo código não vale duas vezes mesmo que duas
   * requisições o enviem ao mesmo tempo. Devolve true se o código existia.
   */
  async consume(q: Queryable, userId: string, codeHash: string) {
    const result = await q.query(
      "DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash",
      [userId, codeHash]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Substitui o conjunto inteiro: os códigos antigos deixam de valer. */
  async replaceAll(q: Queryable, userId: string, codeHashes: string[]) {
    await this.deleteAll(q, userId);
    for (const hash of codeHashes)
      await q.query("INSERT INTO recovery_codes VALUES($1,$2)", [userId, hash]);
  }

  async deleteAll(q: Queryable, userId: string) {
    await q.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
  }
}
