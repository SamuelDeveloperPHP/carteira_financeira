import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";

export interface AccessRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  end_reason: "logout" | "expired" | "revoked" | null;
  duration_seconds: number;
  current: boolean;
  ip: string | null;
  device: string | null;
  location: Record<string, unknown>;
}

/**
 * SQL da trilha de acesso (tabela `access_log`). O encerramento por logout,
 * troca de senha/autenticador ou excesso de sessões é feito pelo
 * SessionsRepository, no mesmo comando que apaga a sessão.
 */
@Injectable()
export class AccessLogRepository {
  constructor(private readonly db: Database) {}

  /**
   * Abre o registro de um login completo (chamado na mesma transação que cria a
   * sessão). Aproveita para fechar, como "expired", os acessos antigos do
   * usuário cuja sessão venceu sem logout: a escrita acontece aqui, no login, e
   * não nas consultas (GET não grava; ver `EFFECTIVE_END`).
   */
  async open(
    q: Queryable,
    a: {
      id: string;
      userId: string;
      tokenHash: string;
      minutes: number;
      ip: string | null;
      device: string | null;
      location: unknown;
    }
  ) {
    await this.closeExpired(q, a.userId);
    await q.query(
      "INSERT INTO access_log(id,user_id,token_hash,expires_at,ip,device,location) VALUES($1,$2,$3,now()+($4*interval '1 minute'),$5,$6,$7)",
      [
        a.id,
        a.userId,
        a.tokenHash,
        a.minutes,
        a.ip,
        a.device,
        a.location ?? { status: "unavailable" },
      ]
    );
  }

  /**
   * Fecha como "expired" os acessos cuja sessão venceu sem logout. O instante de
   * encerramento é o próprio vencimento, e não o momento em que alguém olhou.
   */
  private async closeExpired(q: Queryable, userId: string) {
    await q.query(
      `UPDATE access_log SET ended_at=expires_at,end_reason='expired'
       WHERE user_id=$1 AND ended_at IS NULL AND expires_at<=now()`,
      [userId]
    );
  }

  /**
   * As consultas (GET) não escrevem: um acesso cuja sessão já venceu aparece
   * como encerrado no vencimento, mesmo que a linha ainda esteja aberta (ela
   * será fechada de fato no próximo login, por `closeExpired`).
   */
  private static readonly EFFECTIVE_END = `CASE WHEN ended_at IS NULL AND expires_at<=now() THEN expires_at ELSE ended_at END`;

  /** Duração: até o encerramento; se ainda aberto, até agora. */
  private static readonly COLUMNS = `id,started_at,
    ${AccessLogRepository.EFFECTIVE_END} AS ended_at,
    CASE WHEN ended_at IS NULL AND expires_at<=now() THEN 'expired' ELSE end_reason END AS end_reason,
    ip,device,location,
    (token_hash=$2) AS current,
    EXTRACT(EPOCH FROM (coalesce(${AccessLogRepository.EFFECTIVE_END},now())-started_at))::int AS duration_seconds`;

  async page(
    userId: string,
    currentHash: string,
    offset: number,
    limit: number
  ): Promise<AccessRow[]> {
    return (
      await this.db.pool.query(
        `SELECT ${AccessLogRepository.COLUMNS} FROM access_log WHERE user_id=$1
         ORDER BY started_at DESC,id LIMIT ${limit + 1} OFFSET $3`,
        [userId, currentHash, offset]
      )
    ).rows;
  }

  /** Acessos com coordenadas, do mais novo para o mais antigo, para o mapa geral. */
  async withCoordinates(
    userId: string,
    currentHash: string,
    limit: number
  ): Promise<AccessRow[]> {
    return (
      await this.db.pool.query(
        `SELECT ${AccessLogRepository.COLUMNS} FROM access_log
         WHERE user_id=$1 AND location->>'status'='granted'
         ORDER BY started_at DESC,id LIMIT ${limit}`,
        [userId, currentHash]
      )
    ).rows;
  }
}
