import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  HttpException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { Database } from "./db";
import { Audit } from "./audit";
import { SimulatedMail } from "./mail";
import * as S from "./security";

export const RESET_MINUTES = 7;

@Injectable()
export class Auth {
  private dummyHash = S.hashPassword(S.token());
  constructor(
    private readonly db: Database,
    private readonly audit: Audit,
    private readonly mail: SimulatedMail
  ) {}
  // Same answer whether or not the account exists, so it cannot be enumerated.
  async forgot(body: unknown, req: any) {
    const b = S.object(body, ["email"]);
    const email = S.email(b.email);
    await this.throttle(`forgot-ip:${req.ip}`, 10);
    await this.throttle(`forgot-email:${email}`, 3);
    const user = (
      await this.db.pool.query("SELECT id,email FROM users WHERE email=$1", [
        email,
      ])
    ).rows[0];
    req.targetResource = user?.id || null;
    if (user) {
      const value = S.token();
      await this.db.transaction(async c => {
        await c.query(
          "DELETE FROM password_resets WHERE user_id=$1 OR expires_at<now()",
          [user.id]
        );
        await c.query(
          "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3*interval '1 minute'))",
          [S.digest(value), user.id, RESET_MINUTES]
        );
        await this.audit.record(
          "auth.recovery.requested",
          user.id,
          user.id,
          S.context(req),
          { expiresInMinutes: RESET_MINUTES },
          "success",
          null,
          c
        );
      });
      try {
        await this.mail.sendPasswordReset(user.email, value, RESET_MINUTES);
      } catch {
        console.error(
          JSON.stringify({
            event: "mail.failed",
            correlationId: req.correlationId,
          })
        );
      }
    } else
      await this.audit.record(
        "auth.recovery.requested",
        null,
        null,
        S.context(req),
        {},
        "denied",
        "unknown_account"
      );
    return {
      message: `Se o e-mail estiver cadastrado, enviaremos um link válido por ${RESET_MINUTES} minutos.`,
    };
  }
  // Resetting the password never disables the second factor and ends every session.
  async reset(body: unknown, req: any) {
    const b = S.object(body, ["token", "password"]);
    const password = S.password(b.password);
    await this.throttle(`reset-ip:${req.ip}`, 20);
    if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token))
      throw new BadRequestException("Link inválido ou expirado.");
    const hash = await S.hashPassword(password);
    const token = b.token;
    return this.db.transaction(async c => {
      // DELETE ... RETURNING makes the token single-use even under concurrency.
      const row = (
        await c.query(
          "DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
          [S.digest(token)]
        )
      ).rows[0];
      if (!row)
        throw new BadRequestException(
          "Link inválido ou expirado. Solicite um novo."
        );
      req.targetResource = row.user_id;
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        row.user_id,
      ]);
      await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        row.user_id,
      ]);
      await c.query("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
      await c.query("DELETE FROM password_resets WHERE user_id=$1", [
        row.user_id,
      ]);
      await this.audit.record(
        "auth.password.reset",
        row.user_id,
        row.user_id,
        S.context(req),
        {},
        "success",
        null,
        c
      );
      return {
        message: "Senha redefinida. Entre com a nova senha e o segundo fator.",
      };
    });
  }
  async throttle(key: string, limit: number, seconds = 900) {
    const { rows } = await this.db.pool.query(
      `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
      [S.digest(key), seconds]
    );
    if (rows[0].count > limit)
      throw new HttpException(
        "Muitas tentativas. Tente novamente em 15 minutos.",
        429
      );
  }
  async register(body: unknown, req: any) {
    await this.throttle(`register:${req.ip}`, 20);
    const b = S.object(body, ["name", "email", "password"]);
    const name = S.text(b.name, 2, 100),
      email = S.email(b.email),
      hash = await S.hashPassword(S.password(b.password));
    const id = randomUUID();
    try {
      await this.db.transaction(async c => {
        await c.query(
          "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
          [id, name, email, hash]
        );
        await c.query("INSERT INTO wallets(user_id) VALUES($1)", [id]);
        await this.audit.record(
          "account.register",
          id,
          id,
          S.context(req),
          {},
          "success",
          null,
          c
        );
      });
    } catch (e: any) {
      if (e.code === "23505")
        throw new ConflictException(
          "Não foi possível criar a conta com os dados informados."
        );
      throw e;
    }
    return {
      message:
        "Conta criada com saldo zero. Entre para configurar seu autenticador.",
    };
  }
  async login(body: unknown, req: any) {
    const b = S.object(body, ["email", "password", "location"]);
    const email = S.email(b.email);
    S.text(b.password, 1, 128);
    const pass = b.password as string;
    req.accessLocation = S.location(b.location);
    const { rows } = await this.db.pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );
    const user = rows[0];
    req.targetResource = user?.id || null;
    await this.throttle(`login-ip:${req.ip}`, 50);
    await this.throttle(`login-email:${email}`, 10);
    const valid = await S.checkPassword(
      pass,
      user?.password_hash || (await this.dummyHash)
    );
    if (!user || !valid)
      throw new UnauthorizedException("Credenciais inválidas.");
    req.auth = { user_id: user.id };
    return this.db.transaction(async c => {
      const fresh = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [user.id])
      ).rows[0];
      const stage = fresh.totp_enabled ? "challenge" : "setup";
      const value = S.token();
      const ctx = S.context(req);
      await c.query(
        "DELETE FROM sessions WHERE user_id=$1 AND (stage<>$2 OR expires_at<now())",
        [user.id, "full"]
      );
      await c.query(
        "INSERT INTO sessions(token_hash,user_id,stage,expires_at,context) VALUES($1,$2,$3,now()+interval '10 minutes',$4)",
        [S.digest(value), user.id, stage, ctx]
      );
      await this.audit.record(
        "auth.password.accepted",
        user.id,
        user.id,
        ctx,
        {},
        "success",
        null,
        c
      );
      return { cookie: value, stage };
    });
  }
  async session(raw: string | undefined) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
      throw new UnauthorizedException("Entre para continuar.");
    const { rows } = await this.db.pool.query(
      `SELECT s.*,u.name,u.email,u.role,u.totp_enabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()`,
      [S.digest(raw)]
    );
    if (!rows[0])
      throw new UnauthorizedException("Sessão expirada. Entre novamente.");
    return rows[0];
  }
  async setup(req: any) {
    const result = await this.db.transaction(async c => {
      const user = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.auth.user_id,
        ])
      ).rows[0];
      if (user.totp_enabled || req.auth.stage !== "setup")
        throw new ForbiddenException("Configuração indisponível.");
      const secret = user.totp_secret
        ? S.decrypt(user.totp_secret)
        : S.newSecret();
      if (!user.totp_secret)
        await c.query("UPDATE users SET totp_secret=$1 WHERE id=$2", [
          S.encrypt(secret),
          user.id,
        ]);
      await this.audit.record(
        "auth.enrollment.view",
        user.id,
        user.id,
        S.context(req),
        {},
        "success",
        null,
        c
      );
      return { secret, uri: S.totp(secret, user.email).toString() };
    });
    return { ...result, qr: await QRCode.toDataURL(result.uri) };
  }
  private async verifyCode(
    c: any,
    user: any,
    code: string,
    allowRecovery: boolean
  ) {
    if (allowRecovery && /^[a-f0-9]{16}$/.test(code)) {
      const result = await c.query(
        "DELETE FROM recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING code_hash",
        [user.id, S.digest(code)]
      );
      if (!result.rowCount)
        throw new UnauthorizedException("Código inválido ou já utilizado.");
      return "recovery";
    }
    const step =
      user.totp_secret && /^\d{6}$/.test(code)
        ? S.totpStep(S.decrypt(user.totp_secret), code)
        : null;
    if (step === null || step <= Number(user.last_totp_step))
      throw new UnauthorizedException(
        "Código inválido ou já utilizado. Aguarde o próximo código."
      );
    await c.query("UPDATE users SET last_totp_step=$1 WHERE id=$2", [
      step,
      user.id,
    ]);
    return "totp";
  }
  async verify(body: unknown, req: any) {
    const b = S.object(body, ["code"]);
    const code = S.text(b.code, 6, 32).replace(/[-\s]/g, "").toLowerCase();
    await this.throttle(`2fa:${req.auth.user_id}`, 10);
    await this.throttle(`2fa-ip:${req.ip}`, 40);
    return this.db.transaction(async c => {
      const user = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.auth.user_id,
        ])
      ).rows[0];
      const session = (
        await c.query(
          "SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
          [req.auth.token_hash]
        )
      ).rows[0];
      if (
        !session ||
        !["setup", "challenge"].includes(session.stage) ||
        (session.stage === "setup" && user.totp_enabled)
      )
        throw new UnauthorizedException("Reinicie o login.");
      const method = await this.verifyCode(
        c,
        user,
        code,
        session.stage === "challenge"
      );
      let recoveryCodes: string[] = [];
      if (session.stage === "setup") {
        recoveryCodes = Array.from({ length: 8 }, () =>
          randomBytes(8).toString("hex")
        );
        await c.query("DELETE FROM recovery_codes WHERE user_id=$1", [user.id]);
        for (const item of recoveryCodes)
          await c.query("INSERT INTO recovery_codes VALUES($1,$2)", [
            user.id,
            S.digest(item),
          ]);
        await c.query("UPDATE users SET totp_enabled=true WHERE id=$1", [
          user.id,
        ]);
      }
      const value = S.token();
      await c.query("DELETE FROM sessions WHERE token_hash=$1", [
        session.token_hash,
      ]);
      await c.query(
        "INSERT INTO sessions(token_hash,user_id,stage,expires_at,context) VALUES($1,$2,'full',now()+interval '8 hours',$3)",
        [S.digest(value), user.id, session.context]
      );
      await this.audit.record(
        "auth.login",
        user.id,
        user.id,
        S.context(req),
        { method, enrolled: session.stage === "setup" },
        "success",
        null,
        c
      );
      return {
        cookie: value,
        stage: "full",
        recoveryCodes,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    });
  }
  async rotate(body: unknown, req: any) {
    const b = S.object(body, ["password", "code"]);
    S.text(b.password, 1, 128);
    const pass = b.password as string,
      code = S.text(b.code, 6, 32).replace(/[-\s]/g, "").toLowerCase();
    await this.throttle(`rotate:${req.auth.user_id}`, 5);
    return this.db.transaction(async c => {
      const user = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.auth.user_id,
        ])
      ).rows[0];
      if (!(await S.checkPassword(pass, user.password_hash)))
        throw new UnauthorizedException("Credenciais inválidas.");
      await this.verifyCode(c, user, code, true);
      await c.query(
        "UPDATE users SET totp_secret=NULL,totp_enabled=false,last_totp_step=-1 WHERE id=$1",
        [user.id]
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await c.query("DELETE FROM recovery_codes WHERE user_id=$1", [user.id]);
      const value = S.token();
      await c.query(
        "INSERT INTO sessions VALUES($1,$2,'setup',now()+interval '10 minutes',$3,now())",
        [S.digest(value), user.id, S.context(req)]
      );
      await this.audit.record(
        "auth.authenticator.reset",
        user.id,
        user.id,
        S.context(req),
        {},
        "success",
        null,
        c
      );
      return { cookie: value, stage: "setup" };
    });
  }
  async logout(req: any) {
    await this.db.transaction(async c => {
      await c.query("DELETE FROM sessions WHERE token_hash=$1", [
        req.auth.token_hash,
      ]);
      await this.audit.record(
        "auth.logout",
        req.auth.user_id,
        req.auth.user_id,
        S.context(req),
        {},
        "success",
        null,
        c
      );
    });
    return { message: "Sessão encerrada." };
  }
}
