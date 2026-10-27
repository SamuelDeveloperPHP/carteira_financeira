import { ConflictException, Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";
import { IdempotencyRepository } from "./idempotency.repository";
import { Movement } from "./wallet.types";

@Injectable()
export class IdempotencyService {
  constructor(private readonly store: IdempotencyRepository) {}

  // Returns the movement of an earlier identical request, nothing for a new one,
  // and refuses a reused key that carries different data.
  async replay(
    tx: Queryable,
    scope: string,
    key: string,
    fingerprint: string
  ): Promise<Movement | undefined> {
    await this.store.lock(tx, `${scope}:${key}`);
    const previous = await this.store.find(tx, scope, key);
    if (previous && previous.fingerprint !== fingerprint)
      throw new ConflictException(
        "Esta identificação já foi usada com outros dados."
      );
    return previous?.movement;
  }
  // Serialises operations that must happen at most once per original movement.
  lockOriginal(tx: Queryable, originalId: string) {
    return this.store.lock(tx, `refund-original:${originalId}`);
  }
  remember(
    tx: Queryable,
    scope: string,
    key: string,
    fingerprint: string,
    movementId: string
  ) {
    return this.store.save(tx, scope, key, fingerprint, movementId);
  }
}
