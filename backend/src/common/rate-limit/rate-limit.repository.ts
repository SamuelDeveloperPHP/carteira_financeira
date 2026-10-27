import { Injectable } from "@nestjs/common";
import { Database } from "../database/database.service";
import { digest } from "../security/crypto";

/** SQL do contador de tentativas (tabela `rate_limits`). */
@Injectable()
export class RateLimitRepository {
  constructor(private readonly db: Database) {}

  /**
   * Conta mais uma tentativa na janela e devolve quantas já ocorreram nela.
   *
   * Uma única instrução atômica (INSERT ... ON CONFLICT DO UPDATE), então
   * requisições simultâneas não perdem contagem:
   *   - chave nova                  -> cria com contador 1 e janela de `seconds`;
   *   - janela já expirada          -> recomeça em 1 com nova validade;
   *   - janela ainda válida         -> soma 1 e mantém a validade.
   *
   * A chave é guardada como SHA-256 (digest): a tabela não expõe e-mails nem IPs
   * em claro, mas continua determinística para o mesmo usuário.
   */
  async hit(key: string, seconds: number): Promise<number> {
    const { rows } = await this.db.pool.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [digest(key), seconds]
    );
    return rows[0].count;
  }
}
