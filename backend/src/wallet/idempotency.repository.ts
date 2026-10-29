import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";
import { Movement } from "./wallet.types";

/** O que ficou guardado de uma requisição anterior: a "impressão digital" dos dados e o movimento gerado. */
export interface StoredRequest {
  fingerprint: string;
  movement: Movement;
}

/** SQL da tabela `idempotency` e das travas que serializam requisições repetidas. */
@Injectable()
export class IdempotencyRepository {
  /**
   * Trava consultiva (advisory lock) no escopo da TRANSAÇÃO: duas requisições
   * com a mesma chave que chegam juntas ficam em fila aqui. A segunda só segue
   * depois que a primeira comita, e então enxerga o resultado gravado em vez de
   * executar de novo. A trava é solta sozinha no COMMIT/ROLLBACK.
   * `hashtextextended` transforma o texto da chave em um número de 64 bits.
   */
  async lock(q: Queryable, key: string) {
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
  }

  /** Procura uma requisição anterior com o mesmo escopo e chave, já com o movimento que ela gerou. */
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
    // Separa a impressão digital das colunas do movimento.
    const { fingerprint, ...movement } = row;
    return { fingerprint, movement };
  }

  /** Registra o resultado, na MESMA transação do movimento: ou os dois existem, ou nenhum. */
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
