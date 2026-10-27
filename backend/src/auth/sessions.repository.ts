import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import {
  AuditContext,
  SessionStage,
  SessionUser,
} from "../common/http/request.types";

export interface NewSession {
  tokenHash: string;
  userId: string;
  stage: SessionStage;
  minutes: number;
  context: Partial<AuditContext>;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  stage: SessionStage;
  context: Partial<AuditContext>;
}

/**
 * SQL das sessões, guardadas no servidor e identificadas pelo SHA-256 do token do
 * cookie (nunca o token em si). Por serem estado no servidor, uma sessão pode
 * ser revogada na hora, algo que um token autocontido (JWT) não permite.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly db: Database) {}
  /**
   * Cria a sessão. A validade é calculada com o relógio do BANCO (now() + N
   * minutos), não o da aplicação, evitando divergência entre várias instâncias.
   */
  async create(q: Queryable, s: NewSession) {
    await q.query(
      "INSERT INTO sessions(token_hash,user_id,stage,expires_at,context) VALUES($1,$2,$3,now()+($4*interval '1 minute'),$5)",
      [s.tokenHash, s.userId, s.stage, s.minutes, s.context]
    );
  }
  /** Sessão ainda válida (não vencida) já junto com os dados do usuário, em uma só consulta. */
  async findActiveWithUser(tokenHash: string): Promise<SessionUser | undefined> {
    return (
      await this.db.pool.query(
        `SELECT s.*,u.name,u.email,u.role,u.totp_enabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()`,
        [tokenHash]
      )
    ).rows[0];
  }
  /**
   * Bloqueia a linha da sessão (FOR UPDATE): duas tentativas simultâneas de 2FA
   * na mesma sessão entram em fila e não concluem o login duas vezes.
   */
  async lockActive(
    q: Queryable,
    tokenHash: string
  ): Promise<SessionRow | undefined> {
    return (
      await q.query(
        "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
        [tokenHash]
      )
    ).rows[0];
  }
  /** Apaga uma sessão (logout ou troca de token). */
  async delete(q: Queryable, tokenHash: string) {
    await q.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash]);
  }
  /** Encerra TODAS as sessões do usuário: troca de senha ou de autenticador. */
  async deleteByUser(q: Queryable, userId: string) {
    await q.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
  }
  // Um novo login por senha substitui qualquer sessão de 2FA deixada pela metade
  // e aproveita para limpar sessões vencidas (sem precisar de rotina agendada).
  async deleteIncomplete(q: Queryable, userId: string) {
    await q.query(
      "DELETE FROM sessions WHERE user_id=$1 AND (stage<>'full' OR expires_at<now())",
      [userId]
    );
  }
  // Mantém só as `keep` sessões completas mais novas; as mais antigas são
  // revogadas. Limita quantos aparelhos/cookies podem estar logados ao mesmo tempo.
  async trimFull(q: Queryable, userId: string, keep: number) {
    await q.query(
      "DELETE FROM sessions WHERE user_id=$1 AND stage='full' AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=$1 AND stage='full' ORDER BY created_at DESC, token_hash LIMIT $2)",
      [userId, keep]
    );
  }
}
