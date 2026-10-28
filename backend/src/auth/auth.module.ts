import { Module } from "@nestjs/common";
import { AccessModule } from "../access/access.module";
import { SettingsModule } from "../settings/settings.module";
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

/**
 * Identidade e acesso. Três serviços com responsabilidades separadas:
 *   AuthService             -> cadastro, login (senha), conclusão do 2FA, logout, leitura da sessão
 *   TwoFactorService        -> cadastro do autenticador, conferência de códigos, códigos de recuperação
 *   PasswordRecoveryService -> link de redefinição de senha
 */
@Module({
  // SettingsModule: geolocalização no login e rosto na recuperação de senha.
  // AccessModule: abre o registro da trilha de acesso.
  imports: [UsersModule, SettingsModule, AccessModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    PasswordRecoveryService,
    SessionsRepository,
    RecoveryCodesRepository,
    PasswordResetsRepository,
    // Mesma ideia do depósito: o serviço depende da interface MAIL_PROVIDER.
    // Para enviar e-mail de verdade (SMTP, API transacional), troca-se esta linha.
    { provide: MAIL_PROVIDER, useClass: SimulatedMail },
  ],
  // O AccessGuard global precisa do AuthService para resolver o cookie em sessão.
  exports: [AuthService],
})
export class AuthModule {}
