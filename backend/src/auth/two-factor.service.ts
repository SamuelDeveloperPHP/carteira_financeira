import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AuditService } from "../common/audit/audit.service";
import { Database, Queryable } from "../common/database/database.service";
import { PARTIAL_SESSION_MINUTES } from "../common/constants";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import {
  checkPassword,
  decrypt,
  digest,
  encrypt,
  newSecret,
  token,
  totp,
  totpStep,
} from "../common/security/crypto";
import { UserRow, UsersRepository } from "../users/users.repository";
import { PasswordResetsRepository } from "./password-resets.repository";
import { RecoveryCodesRepository } from "./recovery-codes.repository";
import { RotateDto } from "./dto/auth.dto";
import { SessionsRepository } from "./sessions.repository";

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly recovery: RecoveryCodesRepository,
    private readonly resets: PasswordResetsRepository,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter
  ) {}

  async setup(req: AppRequest) {
    const auth = sessionOf(req);
    const result = await this.db.transaction(async tx => {
      const user = await this.users.lockById(tx, auth.user_id);
      if (user.totp_enabled || auth.stage !== "setup")
        throw new ForbiddenException("Configuração indisponível.");
      const secret = user.totp_secret
        ? decrypt(user.totp_secret)
        : newSecret();
      if (!user.totp_secret)
        await this.users.setTotpSecret(tx, user.id, encrypt(secret));
      await this.audit.record(
        "auth.enrollment.view",
        user.id,
        user.id,
        auditContext(req),
        {},
        "success",
        null,
        tx
      );
      return { secret, uri: totp(secret, user.email).toString() };
    });
    return { ...result, qr: await QRCode.toDataURL(result.uri) };
  }

  // Accepts a TOTP code (never the same time step twice) or, when allowed, a
  // single-use recovery code.
  async verifyCode(
    tx: Queryable,
    user: UserRow,
    code: string,
    allowRecovery: boolean
  ): Promise<"recovery" | "totp"> {
    if (allowRecovery && /^[a-f0-9]{16}$/.test(code)) {
      if (!(await this.recovery.consume(tx, user.id, digest(code))))
        throw new UnauthorizedException("Código inválido ou já utilizado.");
      return "recovery";
    }
    const step =
      user.totp_secret && /^\d{6}$/.test(code)
        ? totpStep(decrypt(user.totp_secret), code)
        : null;
    if (step === null || step <= Number(user.last_totp_step))
      throw new UnauthorizedException(
        "Código inválido ou já utilizado. Aguarde o próximo código."
      );
    await this.users.recordTotpStep(tx, user.id, step);
    return "totp";
  }

  async issueRecoveryCodes(tx: Queryable, userId: string) {
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(8).toString("hex")
    );
    await this.recovery.replaceAll(tx, userId, codes.map(digest));
    return codes;
  }

  // Changing the authenticator needs the password plus a valid second factor,
  // revokes every session and leaves the account unusable until re-enrolled.
  async rotate(dto: RotateDto, req: AppRequest) {
    const auth = sessionOf(req);
    await this.limiter.throttle(`rotate:${auth.user_id}`, 5);
    return this.db.transaction(async tx => {
      const user = await this.users.lockById(tx, auth.user_id);
      if (!(await checkPassword(dto.password, user.password_hash)))
        throw new UnauthorizedException("Credenciais inválidas.");
      await this.verifyCode(tx, user, dto.code, true);
      await this.users.resetTotp(tx, user.id);
      await this.sessions.deleteByUser(tx, user.id);
      await this.recovery.deleteAll(tx, user.id);
      await this.resets.deleteForUser(tx, user.id);
      const value = token();
      await this.sessions.create(tx, {
        tokenHash: digest(value),
        userId: user.id,
        stage: "setup",
        minutes: PARTIAL_SESSION_MINUTES,
        context: auditContext(req),
      });
      await this.audit.record(
        "auth.authenticator.reset",
        user.id,
        user.id,
        auditContext(req),
        {},
        "success",
        null,
        tx
      );
      return { cookie: value, stage: "setup" as const };
    });
  }
}
