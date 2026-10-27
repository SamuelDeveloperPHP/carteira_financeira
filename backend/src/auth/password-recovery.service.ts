import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { RESET_MINUTES } from "../common/constants";
import { Database } from "../common/database/database.service";
import { auditContext } from "../common/http/request-context";
import { AppRequest } from "../common/http/request.types";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import { digest, hashPassword, token } from "../common/security/crypto";
import { UsersRepository } from "../users/users.repository";
import { ForgotPasswordDto, ResetPasswordDto } from "./dto/auth.dto";
import { MAIL_PROVIDER, MailProvider } from "./mail/mail.provider";
import { PasswordResetsRepository } from "./password-resets.repository";
import { SessionsRepository } from "./sessions.repository";

@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly resets: PasswordResetsRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider
  ) {}

  // Same answer whether or not the account exists, so it cannot be enumerated.
  async forgot(dto: ForgotPasswordDto, req: AppRequest) {
    await this.limiter.throttle(`forgot-ip:${req.ip}`, 10);
    await this.limiter.throttle(`forgot-email:${dto.email}`, 3);
    const user = await this.users.findByEmail(dto.email);
    req.targetResource = user?.id || null;
    if (user) {
      const value = token();
      await this.db.transaction(async tx => {
        await this.resets.issue(tx, user.id, digest(value), RESET_MINUTES);
        await this.audit.record(
          "auth.recovery.requested",
          user.id,
          user.id,
          auditContext(req),
          { expiresInMinutes: RESET_MINUTES },
          "success",
          null,
          tx
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
        auditContext(req),
        {},
        "denied",
        "unknown_account"
      );
    return {
      message: `Se o e-mail estiver cadastrado, enviaremos um link válido por ${RESET_MINUTES} minutos.`,
    };
  }

  // Resetting the password never disables the second factor and ends every session.
  async reset(dto: ResetPasswordDto, req: AppRequest) {
    await this.limiter.throttle(`reset-ip:${req.ip}`, 20);
    const hash = await hashPassword(dto.password);
    return this.db.transaction(async tx => {
      const userId = await this.resets.consume(tx, digest(dto.token));
      if (!userId)
        throw new BadRequestException(
          "Link inválido ou expirado. Solicite um novo."
        );
      req.targetResource = userId;
      await this.users.lockById(tx, userId);
      await this.users.setPassword(tx, userId, hash);
      await this.sessions.deleteByUser(tx, userId);
      await this.resets.deleteForUser(tx, userId);
      await this.audit.record(
        "auth.password.reset",
        userId,
        userId,
        auditContext(req),
        {},
        "success",
        null,
        tx
      );
      return {
        message: "Senha redefinida. Entre com a nova senha e o segundo fator.",
      };
    });
  }
}
