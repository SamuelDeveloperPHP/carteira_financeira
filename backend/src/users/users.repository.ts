import { Injectable } from "@nestjs/common";
import { Database, Queryable } from "../common/database/database.service";
import { Role } from "../common/http/request.types";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  totp_secret: string | null;
  totp_enabled: boolean;
  last_totp_step: string;
  created_at: Date;
}

export interface NewUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role?: Role;
}

/**
 * SQL de usuários e suas carteiras. Os métodos aceitam um `Queryable`: quando
 * recebem a transação do chamador, participam dela (tudo ou nada); as leituras
 * sem transação usam o pool por padrão.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly db: Database) {}
  async findByEmail(
    email: string,
    q: Queryable = this.db.pool
  ): Promise<UserRow | undefined> {
    return (await q.query("SELECT * FROM users WHERE email=$1", [email]))
      .rows[0];
  }
  async findById(
    id: string,
    q: Queryable = this.db.pool
  ): Promise<UserRow | undefined> {
    return (await q.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
  }
  // Só clientes comuns recebem dinheiro: o filtro role='user' impede transferir
  // para o master, que é um perfil exclusivo de auditoria e não tem carteira operável.
  async findCustomerIdByEmail(
    email: string,
    q: Queryable = this.db.pool
  ): Promise<string | undefined> {
    return (
      await q.query("SELECT id FROM users WHERE email=$1 AND role='user'", [
        email,
      ])
    ).rows[0]?.id;
  }
  /**
   * Lê o usuário bloqueando a linha (FOR UPDATE) até o fim da transação. Garante
   * que mudanças simultâneas nos dados de segurança do mesmo usuário (2FA,
   * senha, último código aceito) aconteçam uma de cada vez.
   */
  async lockById(q: Queryable, id: string): Promise<UserRow> {
    return (await q.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id]))
      .rows[0];
  }
  async insert(q: Queryable, user: NewUser) {
    await q.query(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [user.id, user.name, user.email, user.passwordHash, user.role ?? "user"]
    );
  }
  async insertWallet(q: Queryable, userId: string) {
    await q.query("INSERT INTO wallets(user_id) VALUES($1)", [userId]);
  }
  async setPassword(q: Queryable, id: string, passwordHash: string) {
    await q.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      passwordHash,
      id,
    ]);
  }
  async setTotpSecret(q: Queryable, id: string, encrypted: string) {
    await q.query("UPDATE users SET totp_secret=$1 WHERE id=$2", [
      encrypted,
      id,
    ]);
  }
  async enableTotp(q: Queryable, id: string) {
    await q.query("UPDATE users SET totp_enabled=true WHERE id=$1", [id]);
  }
  /**
   * Grava o último intervalo de 30 s aceito. Um código só vale se o intervalo for
   * maior que este valor, o que impede reutilizar (replay) o mesmo código.
   */
  async recordTotpStep(q: Queryable, id: string, step: number) {
    await q.query("UPDATE users SET last_totp_step=$1 WHERE id=$2", [step, id]);
  }
  async resetTotp(q: Queryable, id: string) {
    await q.query(
      "UPDATE users SET totp_secret=NULL,totp_enabled=false,last_totp_step=-1 WHERE id=$1",
      [id]
    );
  }
}
