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

  /** Abre o registro de um login completo (chamado na mesma transação que cria a sessão). */
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
    await q.query(
      "INSERT INTO access_log(id,user_id,token_hash,expires_at,ip,device,location) VALUES($1,$2,$3,now()+($4*interval '1 minute'),$5,$6,$7)",
      [a.id, a.userId, a.tokenHash, a.minutes, a.ip, a.device, a.location ?? { status: "unavailable" }]
    );
  }

  /**
   * Fecha como "expired" os acessos cuja sessão venceu sem logout. O instante de
   * encerramento é o próprio vencimento, e não o momento em que alguém olhou.
   */
  async closeExpired(userId: string) {
    await this.db.pool.query(
      `UPDATE access_log SET ended_at=expires_at,end_reason='expired'
       WHERE user_id=$1 AND ended_at IS NULL AND expires_at<=now()`,
      [userId]
    );
  }

  /** Duração: até o encerramento; se ainda aberto, até agora. */
  private static readonly COLUMNS = `id,started_at,ended_at,end_reason,ip,device,location,
    (token_hash=$2) AS current,
    EXTRACT(EPOCH FROM (coalesce(ended_at,now())-started_at))::int AS duration_seconds`;

  async page(userId: string, currentHash: string, offset: number, limit: number): Promise<AccessRow[]> {
    return (
      await this.db.pool.query(
        `SELECT ${AccessLogRepository.COLUMNS} FROM access_log WHERE user_id=$1
         ORDER BY started_at DESC,id LIMIT ${limit + 1} OFFSET $3`,
        [userId, currentHash, offset]
      )
    ).rows;
  }

  /** Acessos com coordenadas, do mais novo para o mais antigo, para o mapa geral. */
  async withCoordinates(userId: string, currentHash: string, limit: number): Promise<AccessRow[]> {
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
