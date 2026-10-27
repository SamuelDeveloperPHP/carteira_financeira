import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";
import { Movement } from "./wallet.types";

export interface StoredRequest {
  fingerprint: string;
  movement: Movement;
}

@Injectable()
export class IdempotencyRepository {
  // Transaction-scoped lock: concurrent retries wait here before reading the result.
  async lock(q: Queryable, key: string) {
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  }
  async find(
    q: Queryable,
    scope: string,
    key: string
  ): Promise<StoredRequest | undefined> {
    const row = (
      await q.query(
        "SELECT i.fingerprint,m.* FROM idempotency i JOIN movements m ON m.id=i.movement_id WHERE scope=$1 AND key=$2",
        [scope, key]
      )
    ).rows[0];
    if (!row) return undefined;
    const { fingerprint, ...movement } = row;
    return { fingerprint, movement };
  }
  async save(
    q: Queryable,
    scope: string,
    key: string,
    fingerprint: string,
    movementId: string
  ) {
    await q.query("INSERT INTO idempotency VALUES($1,$2,$3,$4)", [
      scope,
      key,
      fingerprint,
      movementId,
    ]);
  }
}
