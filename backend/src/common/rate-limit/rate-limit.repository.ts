import { Injectable } from "@nestjs/common";
import { Database } from "../database/database.service";
import { digest } from "../security/crypto";

/** SQL do contador de tentativas (tabela `rate_limits`). */
@Injectable()
export class RateLimitRepository {
  constructor(private readonly db: Database) {}

  /** Em média 1 contagem a cada `PURGE_EVERY` dispara a limpeza das janelas vencidas. */
  private static readonly PURGE_EVERY = 200;

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
    // Sem esta limpeza a tabela só cresce (uma linha por e-mail/IP já visto).
    // É oportunista, sem agendador: o custo é diluído nas próprias contagens e
    // uma falha aqui nunca pode derrubar o login que acabou de ser contado.
    if (Math.random() < 1 / RateLimitRepository.PURGE_EVERY)
      void this.purgeExpired().catch(() => undefined);
    return rows[0].count;
  }

  /** Quantas tentativas a janela da chave já registrou (0 se não há janela ou ela venceu). Não conta. */
  async count(key: string): Promise<number> {
    const { rows } = await this.db.pool.query(
      "SELECT count FROM rate_limits WHERE key=$1 AND expires_at>now()",
      [digest(key)]
    );
    return rows[0]?.count ?? 0;
  }

  /** Zera a janela da chave (usado quando a tentativa dá certo). */
  async reset(key: string): Promise<void> {
    await this.db.pool.query("DELETE FROM rate_limits WHERE key=$1", [
      digest(key),
    ]);
  }

  /** Apaga as janelas já vencidas (o índice em expires_at evita varrer a tabela). */
  async purgeExpired(): Promise<number> {
    const result = await this.db.pool.query(
      "DELETE FROM rate_limits WHERE expires_at<now()"
    );
    return result.rowCount ?? 0;
  }
}
