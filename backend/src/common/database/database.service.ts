import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** What repositories need: satisfied by both the pool and a transaction client. */
export interface Queryable {
  query<R extends QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
}

export type Transaction = PoolClient;

/**
 * Pool de conexões PostgreSQL e "unidade de trabalho" (Unit of Work) de toda
 * operação financeira: agrupa vários comandos SQL em uma única transação
 * atômica (tudo ou nada).
 *
 * Limites do pool: no máximo 15 conexões simultâneas, 5 s para obter uma e 15 s
 * por comando. Isso evita que uma consulta presa segure o sistema inteiro.
 */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 15,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  /**
   * Executa `work` de forma atômica: COMMIT se terminar bem, ROLLBACK se lançar
   * qualquer erro. É esta função que garante que um erro no meio de uma
   * transferência desfaz TUDO (débito, crédito, lançamentos, auditoria).
   *
   * O erro propagado é sempre o do chamador, mesmo que o próprio ROLLBACK falhe
   * (ex.: a conexão caiu), para que a causa raiz não seja escondida.
   */
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Se até o ROLLBACK falhou, a conexão está inutilizável: é descartada
        // (release(true)) em vez de voltar ao pool e contaminar a próxima operação.
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken ? true : undefined);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
