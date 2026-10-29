import { Injectable } from "@nestjs/common";
import { Database } from "../common/database/database.service";

export type Bucket = "day" | "week" | "month";

export interface KindRow {
  kind: string;
  incoming: boolean;
  n: number;
  total: string;
  biggest: string;
}
export interface SeriesRow {
  bucket: Date;
  income: string;
  expense: string;
  balance_after: string;
}
export interface CounterpartRow {
  id: string;
  name: string;
  received: string;
  sent: string;
  n: number;
}

/**
 * Agregações SQL do BI. Todas partem de `entries` (o razão), filtradas pelo
 * usuário da sessão e pelo início do período, então só leem dados dele.
 * Somas voltam como texto (bigint) e o serviço as converte. `bucket` só recebe
 * valores do tipo `Bucket` (escolhidos no serviço), nunca texto do cliente.
 */
@Injectable()
export class InsightsRepository {
  constructor(private readonly db: Database) {}

  async balance(userId: string): Promise<string> {
    const r = await this.db.pool.query(
      "SELECT balance::text AS balance FROM wallets WHERE user_id=$1",
      [userId]
    );
    return r.rows[0]?.balance ?? "0";
  }

  /** Totais por tipo de movimento e sentido (entrada/saída). */
  async byKind(userId: string, days: number): Promise<KindRow[]> {
    return (
      await this.db.pool.query(
        `SELECT m.kind,(e.delta>0) AS incoming,count(*)::int AS n,
                sum(abs(e.delta))::text AS total,max(abs(e.delta))::text AS biggest
         FROM entries e JOIN movements m ON m.id=e.movement_id
         WHERE e.user_id=$1 AND e.created_at>=now()-($2*interval '1 day')
         GROUP BY 1,2`,
        [userId, days]
      )
    ).rows;
  }

  /** Série por dia, semana ou mês: entradas, saídas e o saldo ao fim de cada intervalo. */
  async series(
    userId: string,
    days: number,
    bucket: Bucket
  ): Promise<SeriesRow[]> {
    return (
      await this.db.pool.query(
        `SELECT date_trunc('${bucket}',e.created_at) AS bucket,
                coalesce(sum(CASE WHEN e.delta>0 THEN e.delta END),0)::text AS income,
                coalesce(sum(CASE WHEN e.delta<0 THEN -e.delta END),0)::text AS expense,
                (array_agg(e.balance_after ORDER BY e.id DESC))[1]::text AS balance_after
         FROM entries e
         WHERE e.user_id=$1 AND e.created_at>=now()-($2*interval '1 day')
         GROUP BY 1 ORDER BY 1`,
        [userId, days]
      )
    ).rows;
  }

  /** Quem mais aparece nas movimentações (depósitos não têm contraparte e ficam de fora). */
  async counterparts(userId: string, days: number): Promise<CounterpartRow[]> {
    return (
      await this.db.pool.query(
        `SELECT u.id,u.name,
                coalesce(sum(CASE WHEN e.delta>0 THEN e.delta END),0)::text AS received,
                coalesce(sum(CASE WHEN e.delta<0 THEN -e.delta END),0)::text AS sent,
                count(*)::int AS n
         FROM entries e JOIN movements m ON m.id=e.movement_id
         JOIN users u ON u.id=CASE WHEN e.delta>0 THEN m.sender_id ELSE m.recipient_id END
         WHERE e.user_id=$1 AND e.created_at>=now()-($2*interval '1 day')
         GROUP BY u.id,u.name ORDER BY sum(abs(e.delta)) DESC LIMIT 5`,
        [userId, days]
      )
    ).rows;
  }
}
