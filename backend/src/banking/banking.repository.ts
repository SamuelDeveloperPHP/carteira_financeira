import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import { PixKeyType } from "./pix-key.rules";

export interface BankAccountRow {
  id: string;
  bank_code: string;
  agency: string;
  account_number: string;
  account_type: "checking" | "savings" | "payment";
  holder_document: string;
  created_at: Date;
}

export interface PixKeyRow {
  id: string;
  bank_account_id: string;
  user_id: string;
  key_type: PixKeyType;
  key_value: string;
  status: "pending" | "approved" | "rejected";
  protocol: string;
  reason: string | null;
  proof_hash: string | null;
  proof_expires_at: Date | null;
  proof_attempts: number;
  created_at: Date;
  approved_at: Date | null;
}

/**
 * SQL de contas bancárias e chaves Pix. TODA consulta filtra por `user_id`:
 * uma conta ou chave de outra pessoa é indistinguível de uma inexistente (404).
 */
@Injectable()
export class BankingRepository {
  constructor(private readonly db: Database) {}

  async listAccounts(userId: string): Promise<BankAccountRow[]> {
    return (
      await this.db.pool.query(
        "SELECT id,bank_code,agency,account_number,account_type,holder_document,created_at FROM bank_accounts WHERE user_id=$1 ORDER BY created_at,id",
        [userId]
      )
    ).rows;
  }

  async listKeys(userId: string): Promise<PixKeyRow[]> {
    return (
      await this.db.pool.query(
        "SELECT * FROM pix_keys WHERE user_id=$1 ORDER BY created_at,id",
        [userId]
      )
    ).rows;
  }

  async countAccounts(q: Queryable, userId: string): Promise<number> {
    return (
      await q.query(
        "SELECT count(*)::int AS n FROM bank_accounts WHERE user_id=$1",
        [userId]
      )
    ).rows[0].n;
  }

  async insertAccount(
    q: Queryable,
    a: {
      id: string;
      userId: string;
      bankCode: string;
      agency: string;
      accountNumber: string;
      accountType: string;
      holderDocument: string;
    }
  ) {
    await q.query(
      "INSERT INTO bank_accounts(id,user_id,bank_code,agency,account_number,account_type,holder_document) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        a.id,
        a.userId,
        a.bankCode,
        a.agency,
        a.accountNumber,
        a.accountType,
        a.holderDocument,
      ]
    );
  }

  /** Bloqueia a conta (FOR UPDATE): duas inclusões simultâneas não furam o limite de chaves. */
  async lockAccount(
    q: Queryable,
    userId: string,
    id: string
  ): Promise<BankAccountRow | undefined> {
    return (
      await q.query(
        "SELECT * FROM bank_accounts WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, userId]
      )
    ).rows[0];
  }

  async findAccount(
    userId: string,
    id: string
  ): Promise<BankAccountRow | undefined> {
    return (
      await this.db.pool.query(
        "SELECT * FROM bank_accounts WHERE id=$1 AND user_id=$2",
        [id, userId]
      )
    ).rows[0];
  }

  /** As chaves saem junto (ON DELETE CASCADE). */
  async deleteAccount(
    q: Queryable,
    userId: string,
    id: string
  ): Promise<boolean> {
    return (
      ((
        await q.query("DELETE FROM bank_accounts WHERE id=$1 AND user_id=$2", [
          id,
          userId,
        ])
      ).rowCount ?? 0) > 0
    );
  }

  async countKeys(q: Queryable, accountId: string): Promise<number> {
    return (
      await q.query(
        "SELECT count(*)::int AS n FROM pix_keys WHERE bank_account_id=$1",
        [accountId]
      )
    ).rows[0].n;
  }

  async keyExists(value: string): Promise<boolean> {
    return (
      ((
        await this.db.pool.query("SELECT 1 FROM pix_keys WHERE key_value=$1", [
          value,
        ])
      ).rowCount ?? 0) > 0
    );
  }

  async insertKey(
    q: Queryable,
    k: {
      id: string;
      accountId: string;
      userId: string;
      type: PixKeyType;
      value: string;
      status: string;
      protocol: string;
      reason: string | null;
      proofHash: string | null;
      proofMinutes: number | null;
    }
  ) {
    await q.query(
      `INSERT INTO pix_keys(id,bank_account_id,user_id,key_type,key_value,status,protocol,reason,proof_hash,proof_expires_at,approved_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
              CASE WHEN $10::int IS NULL THEN NULL ELSE now()+($10::int*interval '1 minute') END,
              CASE WHEN $6='approved' THEN now() END)`,
      [
        k.id,
        k.accountId,
        k.userId,
        k.type,
        k.value,
        k.status,
        k.protocol,
        k.reason,
        k.proofHash,
        k.proofMinutes,
      ]
    );
  }

  async lockKey(
    q: Queryable,
    userId: string,
    id: string
  ): Promise<PixKeyRow | undefined> {
    return (
      await q.query(
        "SELECT * FROM pix_keys WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, userId]
      )
    ).rows[0];
  }

  async approveKey(q: Queryable, id: string) {
    await q.query(
      "UPDATE pix_keys SET status='approved',approved_at=now(),proof_hash=NULL,proof_expires_at=NULL WHERE id=$1",
      [id]
    );
  }

  /**
   * Conta uma tentativa errada, na MESMA transação que travou a chave (FOR UPDATE):
   * palpites simultâneos entram em fila e cada um enxerga o contador atualizado.
   */
  async addProofAttempt(q: Queryable, id: string) {
    await q.query(
      "UPDATE pix_keys SET proof_attempts=proof_attempts+1 WHERE id=$1",
      [id]
    );
  }

  /** Bloqueia, até o fim da transação, quem mexe neste texto (documento ou usuário): serializa cadastros concorrentes. */
  async lockText(q: Queryable, text: string) {
    await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [text]);
  }

  /** Documento (CPF/CNPJ) já usado nas contas do usuário, se houver. */
  async ownDocument(q: Queryable, userId: string): Promise<string | undefined> {
    return (
      await q.query(
        "SELECT holder_document FROM bank_accounts WHERE user_id=$1 LIMIT 1",
        [userId]
      )
    ).rows[0]?.holder_document;
  }

  /** O documento já está vinculado a OUTRO usuário? */
  async documentTakenByOther(
    q: Queryable,
    userId: string,
    document: string
  ): Promise<boolean> {
    return (
      ((
        await q.query(
          "SELECT 1 FROM bank_accounts WHERE holder_document=$1 AND user_id<>$2 LIMIT 1",
          [document, userId]
        )
      ).rowCount ?? 0) > 0
    );
  }

  async renewProof(
    q: Queryable,
    id: string,
    proofHash: string,
    minutes: number
  ) {
    await q.query(
      "UPDATE pix_keys SET proof_hash=$2,proof_expires_at=now()+($3*interval '1 minute'),proof_attempts=0 WHERE id=$1",
      [id, proofHash, minutes]
    );
  }

  /**
   * Troca o valor da chave e reinicia o registro (nova decisão do diretório,
   * novo código de posse se for o caso). O tipo e a conta não mudam.
   */
  async updateKey(
    q: Queryable,
    id: string,
    k: {
      value: string;
      status: string;
      protocol: string;
      reason: string | null;
      proofHash: string | null;
      proofMinutes: number | null;
    }
  ) {
    await q.query(
      `UPDATE pix_keys SET key_value=$2,status=$3,protocol=$4,reason=$5,proof_hash=$6,
         proof_expires_at=CASE WHEN $7::int IS NULL THEN NULL ELSE now()+($7::int*interval '1 minute') END,
         proof_attempts=0,approved_at=CASE WHEN $3='approved' THEN now() END
       WHERE id=$1`,
      [id, k.value, k.status, k.protocol, k.reason, k.proofHash, k.proofMinutes]
    );
  }

  async deleteKey(q: Queryable, userId: string, id: string): Promise<boolean> {
    return (
      ((
        await q.query("DELETE FROM pix_keys WHERE id=$1 AND user_id=$2", [
          id,
          userId,
        ])
      ).rowCount ?? 0) > 0
    );
  }
}
