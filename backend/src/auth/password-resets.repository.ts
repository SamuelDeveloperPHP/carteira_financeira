import { Injectable } from "@nestjs/common";
import { Queryable } from "../common/database/database.service";

/** SQL dos links de redefinição de senha (tabela `password_resets`). Guarda só o hash do token. */
@Injectable()
export class PasswordResetsRepository {
  /**
   * Registra um novo link. Antes, apaga os anteriores do usuário (assim só o
   * link MAIS RECENTE funciona) e, de passagem, limpa links expirados de
   * qualquer conta, mantendo a tabela pequena sem precisar de rotina agendada.
   */
  async issue(q: Queryable, userId: string, tokenHash: string, minutes: number) {
    await q.query(
      "DELETE FROM password_resets WHERE user_id=$1 OR expires_at<now()",
      [userId]
    );
    await q.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3*interval '1 minute'))",
      [tokenHash, userId, minutes]
    );
  }

  /**
   * Gasta o link: apaga e devolve o dono numa única instrução. Como o banco só
   * deixa UMA transação apagar a mesma linha, duas tentativas simultâneas com o
   * mesmo link nunca têm sucesso as duas (uso único mesmo sob concorrência).
   * Link expirado não casa com `expires_at>now()` e retorna vazio.
   */
  async consume(q: Queryable, tokenHash: string): Promise<string | undefined> {
    return (
      await q.query(
        "DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
        [tokenHash]
      )
    ).rows[0]?.user_id;
  }

  /** Consulta SEM gastar o link: de quem é, se ainda vale. Usado para saber se a redefinição exigirá o rosto. */
  async peek(q: Queryable, tokenHash: string): Promise<string | undefined> {
    return (
      await q.query(
        "SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires_at>now()",
        [tokenHash]
      )
    ).rows[0]?.user_id;
  }

  /** Invalida todos os links pendentes do usuário (após trocar senha ou autenticador). */
  async deleteForUser(q: Queryable, userId: string) {
    await q.query("DELETE FROM password_resets WHERE user_id=$1", [userId]);
  }
}
