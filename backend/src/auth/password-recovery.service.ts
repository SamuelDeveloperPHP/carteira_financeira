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

/**
 * Recuperação de senha por link enviado por e-mail.
 *
 * Fluxo: o usuário pede o link (`forgot`) -> recebe um token aleatório de 256
 * bits -> abre o link e define a nova senha (`reset`).
 *
 * Decisões de segurança:
 *   - o token vale 7 minutos e só pode ser usado UMA vez;
 *   - no banco fica apenas o SHA-256 do token (vazar a tabela não dá links);
 *   - a resposta ao pedido é idêntica exista ou não a conta (sem enumeração);
 *   - redefinir a senha NÃO desliga o 2FA: um e-mail invadido, sozinho, não
 *     basta para tomar a conta.
 */
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

  /**
   * Gera e envia o link de redefinição.
   *
   * A resposta é a MESMA exista ou não a conta: quem digita e-mails alheios não
   * descobre quem é cliente. Pelo mesmo motivo, uma falha no envio do e-mail é
   * registrada em log, mas nunca mostrada na resposta.
   *
   * Limites: 10 pedidos por IP e 3 por e-mail a cada 15 min, para que ninguém
   * use o sistema para encher a caixa de entrada de uma vítima.
   */
  async forgot(dto: ForgotPasswordDto, req: AppRequest) {
    await this.limiter.throttle(`forgot-ip:${req.ip}`, 10);
    await this.limiter.throttle(`forgot-email:${dto.email}`, 3);
    const user = await this.users.findByEmail(dto.email);
    // Liga o evento de auditoria à conta, quando existe.
    req.targetResource = user?.id || null;
    if (user) {
      const value = token();
      // O hash é gravado e auditado na mesma transação; o e-mail só sai DEPOIS
      // do commit, para nunca enviar um link que não ficou gravado.
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
        // Só o ID de correlação vai ao log: nem o e-mail do usuário nem o token.
        console.error(
          JSON.stringify({
            event: "mail.failed",
            correlationId: req.correlationId,
          })
        );
      }
    } else
      // Conta inexistente: nada é enviado, mas o pedido fica auditado (útil para
      // detectar alguém testando e-mails). A resposta ao cliente continua igual.
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

  /**
   * Define a nova senha com um link válido.
   *
   * O token é gasto com DELETE ... RETURNING: duas requisições simultâneas com
   * o mesmo link não conseguem as duas. Depois de trocar a senha, TODAS as
   * sessões do usuário são encerradas (quem tinha a senha antiga é expulso) e o
   * 2FA continua exigido no próximo login.
   */
  async reset(dto: ResetPasswordDto, req: AppRequest) {
    await this.limiter.throttle(`reset-ip:${req.ip}`, 20);
    // scrypt é lento de propósito: calculado antes da transação para não segurar a conexão.
    const hash = await hashPassword(dto.password);
    return this.db.transaction(async tx => {
      // Compara pelo hash do token; link expirado, usado ou inventado cai no mesmo erro.
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
