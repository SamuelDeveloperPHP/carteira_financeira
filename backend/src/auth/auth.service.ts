import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../common/audit/audit.service";
import {
  FULL_SESSION_MINUTES,
  MAX_FULL_SESSIONS,
  PARTIAL_SESSION_MINUTES,
} from "../common/constants";
import { Database } from "../common/database/database.service";
import { auditContext } from "../common/http/request-context";
import {
  AppRequest,
  SessionUser,
  sessionOf,
} from "../common/http/request.types";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import {
  checkPassword,
  digest,
  hashPassword,
  token,
} from "../common/security/crypto";
import { location } from "../common/security/validation";
import { UsersRepository } from "../users/users.repository";
import { LoginDto, RegisterDto, VerifyDto } from "./dto/auth.dto";
import { SessionsRepository } from "./sessions.repository";
import { TwoFactorService } from "./two-factor.service";

/**
 * Registration, password login, second-factor completion and logout.
 * Login happens in two stages: the password creates a partial session
 * ("setup" or "challenge"); only a valid second factor promotes it to "full".
 */
@Injectable()
export class AuthService {
  // Compared against when the account does not exist, so response time does not
  // reveal which e-mails are registered.
  private readonly dummyHash = hashPassword(token());
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly twoFactor: TwoFactorService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter
  ) {}

  /**
   * Creates the user and a zero-balance wallet in one transaction. A duplicate
   * e-mail (unique violation) gets a generic message so registered addresses
   * cannot be discovered.
   */
  async register(dto: RegisterDto, req: AppRequest) {
    // Limite por IP contra criação em massa de contas (spam/abuso).
    await this.limiter.throttle(`register:${req.ip}`, 20);
    // O hash é calculado ANTES de abrir a transação: scrypt é propositalmente
    // lento e não deve segurar conexão do banco enquanto roda.
    const hash = await hashPassword(dto.password);
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        await this.users.insert(tx, {
          id,
          name: dto.name,
          email: dto.email,
          passwordHash: hash,
        });
        await this.users.insertWallet(tx, id);
        await this.audit.record(
          "account.register",
          id,
          id,
          auditContext(req),
          {},
          "success",
          null,
          tx
        );
      });
    } catch (e: any) {
      // 23505 = violação de UNIQUE no PostgreSQL (e-mail já cadastrado). Confiar
      // na restrição do banco, e não em "consultar antes de inserir", evita a
      // corrida em que dois cadastros simultâneos passam pela checagem.
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

  /**
   * Checks e-mail and password (rate limited per IP and per account) and opens
   * a partial session. Unknown e-mail and wrong password are indistinguishable
   * in both message and timing.
   */
  async login(dto: LoginDto, req: AppRequest) {
    // 1) Guarda a localização informada para a auditoria (validada; opcional).
    req.accessLocation = location(dto.location);
    const user = await this.users.findByEmail(dto.email);
    // Associa a tentativa à conta (se existir): login falho também aparece no
    // histórico do usuário na tela do master.
    req.targetResource = user?.id || null;
    // 2) Dois limites independentes: por IP (barra um atacante varrendo contas)
    //    e por e-mail (barra tentativas contra uma conta vindas de vários IPs).
    await this.limiter.throttle(`login-ip:${req.ip}`, 50);
    await this.limiter.throttle(`login-email:${dto.email}`, 10);
    // 3) Confere a senha. Se o e-mail não existe, compara com um hash falso: o
    //    tempo de resposta é o mesmo, então não dá para descobrir quais e-mails
    //    estão cadastrados medindo a latência.
    const valid = await checkPassword(
      dto.password,
      user?.password_hash || (await this.dummyHash)
    );
    // Mesma mensagem para "e-mail inexistente" e "senha errada".
    if (!user || !valid)
      throw new UnauthorizedException("Credenciais inválidas.");
    req.actorId = user.id;
    // 4) Senha correta: abre uma sessão PARCIAL. Ainda não dá acesso ao dinheiro;
    //    falta o segundo fator.
    return this.db.transaction(async tx => {
      // Bloqueia o usuário para ler o estado do 2FA sem corrida com outra aba.
      const fresh = await this.users.lockById(tx, user.id);
      // Já tem autenticador? pede o código ("challenge"). Senão, cadastra ("setup").
      const stage = fresh.totp_enabled ? "challenge" : "setup";
      const value = token();
      const ctx = auditContext(req);
      // Descarta logins incompletos anteriores: só existe um "meio login" por vez.
      await this.sessions.deleteIncomplete(tx, user.id);
      await this.sessions.create(tx, {
        tokenHash: digest(value),
        userId: user.id,
        stage,
        minutes: PARTIAL_SESSION_MINUTES,
        context: ctx,
      });
      await this.audit.record(
        "auth.password.accepted",
        user.id,
        user.id,
        ctx,
        {},
        "success",
        null,
        tx
      );
      return { cookie: value, stage };
    });
  }

  /**
   * Resolves the session cookie to its user. Only the SHA-256 of the token is
   * stored, so a database leak does not yield usable cookies.
   */
  async session(raw: string | undefined): Promise<SessionUser> {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
      throw new UnauthorizedException("Entre para continuar.");
    const session = await this.sessions.findActiveWithUser(digest(raw));
    if (!session)
      throw new UnauthorizedException("Sessão expirada. Entre novamente.");
    return session;
  }

  /**
   * Completes the login: the password was accepted earlier, this proves the
   * second factor. The partial session is replaced by a new full one (token
   * rotation) and the oldest sessions beyond the cap are revoked.
   */
  async verify(dto: VerifyDto, req: AppRequest) {
    const auth = sessionOf(req);
    // Códigos de 6 dígitos têm só 1 milhão de combinações: sem limite de
    // tentativas seriam adivinháveis por força bruta. Limites por conta e por IP.
    await this.limiter.throttle(`2fa:${auth.user_id}`, 10);
    await this.limiter.throttle(`2fa-ip:${req.ip}`, 40);
    return this.db.transaction(async tx => {
      // Trava usuário e sessão: duas verificações simultâneas não completam o
      // mesmo login duas vezes nem reutilizam o mesmo código.
      const user = await this.users.lockById(tx, auth.user_id);
      const session = await this.sessions.lockActive(tx, auth.token_hash);
      if (
        !session ||
        !["setup", "challenge"].includes(session.stage) ||
        (session.stage === "setup" && user.totp_enabled)
      )
        throw new UnauthorizedException("Reinicie o login.");
      const enrolling = session.stage === "setup";
      const method = await this.twoFactor.verifyCode(
        tx,
        user,
        dto.code,
        !enrolling
      );
      let recoveryCodes: string[] = [];
      if (enrolling) {
        // Primeiro acesso: o código correto prova que o usuário configurou o
        // autenticador. Só agora o 2FA é ativado e os códigos de recuperação
        // (mostrados uma única vez) são gerados.
        recoveryCodes = await this.twoFactor.issueRecoveryCodes(tx, user.id);
        await this.users.enableTotp(tx, user.id);
      }
      // Troca de token ("rotação"): a sessão parcial é destruída e nasce uma
      // nova, completa, com token diferente. Impede "fixação de sessão" (um
      // token conhecido antes do 2FA nunca vira um token completo).
      const value = token();
      await this.sessions.delete(tx, session.token_hash);
      await this.sessions.create(tx, {
        tokenHash: digest(value),
        userId: user.id,
        stage: "full",
        minutes: FULL_SESSION_MINUTES,
        context: session.context,
      });
      await this.sessions.trimFull(tx, user.id, MAX_FULL_SESSIONS);
      await this.audit.record(
        "auth.login",
        user.id,
        user.id,
        auditContext(req),
        { method, enrolled: enrolling },
        "success",
        null,
        tx
      );
      return {
        cookie: value,
        stage: "full" as const,
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

  /** Deletes the current session server-side, so the cookie stops working at once. */
  async logout(req: AppRequest) {
    const auth = sessionOf(req);
    await this.db.transaction(async tx => {
      await this.sessions.delete(tx, auth.token_hash);
      await this.audit.record(
        "auth.logout",
        auth.user_id,
        auth.user_id,
        auditContext(req),
        {},
        "success",
        null,
        tx
      );
    });
    return { message: "Sessão encerrada." };
  }
}
