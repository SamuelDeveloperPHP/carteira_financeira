import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MAIL_PROVIDER } from "./mail/mail.provider";
import { SimulatedMail } from "./mail/simulated-mail.provider";
import { PasswordRecoveryService } from "./password-recovery.service";
import { PasswordResetsRepository } from "./password-resets.repository";
import { RecoveryCodesRepository } from "./recovery-codes.repository";
import { SessionsRepository } from "./sessions.repository";
import { TwoFactorService } from "./two-factor.service";

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    PasswordRecoveryService,
    SessionsRepository,
    RecoveryCodesRepository,
    PasswordResetsRepository,
    // Swap this binding for a real provider (SMTP, transactional API) later.
    { provide: MAIL_PROVIDER, useClass: SimulatedMail },
  ],
  exports: [AuthService],
})
export class AuthModule {}
