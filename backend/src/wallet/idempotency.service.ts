import { ConflictException, Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";
import { IdempotencyRepository } from "./idempotency.repository";
import { Movement } from "./wallet.types";

/**
 * Torna as REPETIÇÕES seguras (idempotência).
 *
 * Problema: o cliente envia uma transferência, a rede cai antes da resposta e ele
 * não sabe se foi feita. Se reenviar, poderia pagar duas vezes. Solução: cada
 * pedido leva uma chave única; se a mesma chave chegar de novo com os mesmos
 * dados, devolvemos o resultado original em vez de executar outra vez.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly store: IdempotencyRepository) {}

  /**
   * Consulta se a chave já foi usada:
   *   - mesma chave e MESMOS dados -> devolve o movimento original (repetição);
   *   - mesma chave e dados DIFERENTES -> 409 (provável erro ou tentativa de abuso);
   *   - chave nova -> devolve vazio e a operação segue normalmente.
   *
   * A trava consultiva faz duas requisições simultâneas com a mesma chave
   * entrarem em fila: a segunda só lê depois que a primeira gravou o resultado.
   */
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
  /**
   * Fila por movimento original: usada na devolução para que duas devoluções da
   * MESMA transferência, mesmo com chaves diferentes, não corram juntas.
   */
  lockOriginal(tx: Queryable, originalId: string) {
    return this.store.lock(tx, `refund-original:${originalId}`);
  }

  /** Guarda o resultado (na mesma transação do movimento) para que uma repetição futura o encontre. */
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
