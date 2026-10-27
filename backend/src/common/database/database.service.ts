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

/** PostgreSQL connection pool and unit of work for every financial operation. */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 15,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  /**
   * Runs `work` atomically: COMMIT when it resolves, ROLLBACK when it throws.
   * The caller's error is always the one propagated, even if the ROLLBACK
   * itself fails (e.g. the connection dropped), so the root cause is not hidden.
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
        // A failed rollback means the connection is unusable: discard it
        // instead of returning it to the pool.
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
