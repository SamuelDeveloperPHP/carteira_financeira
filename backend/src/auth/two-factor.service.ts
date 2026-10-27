import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { AuditService } from "../common/audit/audit.service";
import { Database, Queryable } from "../common/database/database.service";
import { PARTIAL_SESSION_MINUTES } from "../common/constants";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { logUnexpected } from "../common/logging/failure-log";
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

/**
 * Segundo fator de autenticação (2FA).
 *
 * Usa TOTP (RFC 6238): o aplicativo autenticador do usuário (Google/Microsoft
 * Authenticator) e o servidor compartilham um segredo e, a cada 30 segundos,
 * ambos calculam o mesmo código de 6 dígitos. Provar que se conhece o código
 * prova que se tem o aparelho, e não só a senha.
 *
 * Este serviço cuida de três coisas:
 *   - cadastro do autenticador (`setup`): mostra o QR code;
 *   - conferência de códigos (`verifyCode`): TOTP ou código de recuperação;
 *   - troca do autenticador (`rotate`): perda ou suspeita de vazamento.
 *
 * O segredo é guardado CIFRADO (AES-256-GCM) com uma chave que vive fora do
 * banco. Quem vaza só o banco não consegue gerar códigos.
 */
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

  /**
   * Mostra o segredo e o QR code para cadastrar o autenticador.
   *
   * Só é permitido a quem está na etapa "setup" e ainda NÃO ativou o 2FA: depois
   * de ativado, ninguém (nem o próprio dono) consegue ver o segredo de novo.
   * O segredo é criado uma única vez e guardado cifrado; recarregar a página
   * mostra o MESMO QR code, em vez de gerar outro que invalidaria o que o
   * usuário já escaneou.
   */
  async setup(req: AppRequest) {
    const auth = sessionOf(req);
    const result = await this.db.transaction(async tx => {
      // Trava o usuário: duas abas abrindo o setup ao mesmo tempo não criam dois segredos.
      const user = await this.users.lockById(tx, auth.user_id);
      if (user.totp_enabled || auth.stage !== "setup")
        throw new ForbiddenException("Configuração indisponível.");
      const secret = user.totp_secret
        ? decrypt(user.totp_secret)
        : newSecret();
      // Primeira vez: grava o segredo já cifrado.
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
    try {
      return { ...result, qr: await QRCode.toDataURL(result.uri) };
    } catch (error) {
      // O segredo já está gravado; ao tentar de novo o usuário recebe o mesmo,
      // então a falha aqui não deixa a conta em estado inconsistente.
      logUnexpected("auth.qrcode.failed", req.correlationId, error);
      throw new ServiceUnavailableException(
        "Não foi possível gerar o QR code. Tente novamente."
      );
    }
  }

  /**
   * Confere o segundo fator. Aceita:
   *   - um código TOTP de 6 dígitos (nunca o mesmo intervalo de tempo duas vezes);
   *   - ou, se `allowRecovery`, um código de recuperação de 16 hexadecimais, de
   *     uso único.
   *
   * Roda dentro da transação do chamador: gastar o código e concluir o login são
   * uma coisa só (ou os dois acontecem, ou nenhum).
   *
   * @returns qual método foi usado, para constar na auditoria.
   */
  async verifyCode(
    tx: Queryable,
    user: UserRow,
    code: string,
    allowRecovery: boolean
  ): Promise<"recovery" | "totp"> {
    // Código de recuperação: o formato (16 hex) o distingue do TOTP (6 dígitos).
    // Comparamos o HASH, pois só hashes ficam no banco; consumir apaga a linha.
    if (allowRecovery && /^[a-f0-9]{16}$/.test(code)) {
      if (!(await this.recovery.consume(tx, user.id, digest(code))))
        throw new UnauthorizedException("Código inválido ou já utilizado.");
      return "recovery";
    }
    // TOTP: decifra o segredo e calcula em qual intervalo de 30 s o código cai
    // (tolerância de um intervalo para cada lado, por diferença de relógio).
    const step =
      user.totp_secret && /^\d{6}$/.test(code)
        ? totpStep(decrypt(user.totp_secret), code)
        : null;
    // Anti-reuso (replay): o intervalo precisa ser MAIOR que o último aceito.
    // Sem isso, um código espiado por cima do ombro valeria por até 90 segundos.
    if (step === null || step <= Number(user.last_totp_step))
      throw new UnauthorizedException(
        "Código inválido ou já utilizado. Aguarde o próximo código."
      );
    await this.users.recordTotpStep(tx, user.id, step);
    return "totp";
  }

  /**
   * Gera 8 códigos de recuperação (64 bits aleatórios cada), substituindo
   * qualquer conjunto anterior. Servem para entrar se o usuário perder o celular.
   *
   * Só os HASHES vão para o banco. Os códigos em claro são devolvidos UMA vez,
   * para o usuário guardar; depois disso nem o sistema consegue mostrá-los.
   */
  async issueRecoveryCodes(tx: Queryable, userId: string) {
    const codes = Array.from({ length: 8 }, () =>
      randomBytes(8).toString("hex")
    );
    await this.recovery.replaceAll(tx, userId, codes.map(digest));
    return codes;
  }

  /**
   * Troca o autenticador (celular perdido, trocado ou comprometido).
   *
   * Exige DUAS provas: a senha e um código válido (TOTP ou de recuperação). Quem
   * roubou só a sessão, sem a senha, não consegue trocá-lo. Em seguida:
   *   - apaga o segredo antigo e desativa o 2FA;
   *   - revoga TODAS as sessões (inclusive a de um possível invasor);
   *   - apaga os códigos de recuperação e links de redefinição pendentes;
   *   - abre uma nova sessão "setup": a conta só volta a operar depois que o
   *     novo autenticador for cadastrado e confirmado.
   */
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
