import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../../auth/auth.service";
import { SESSION_COOKIE } from "../constants";
import { RateLimiter } from "../rate-limit/rate-limiter.service";
import { ACCESS_KEY, AccessLevel, ROLES_KEY } from "./access.decorators";
import { AppRequest, Role } from "./request.types";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * Portão ÚNICO e global de acesso: roda antes de qualquer rota. Está registrado
 * em APP_GUARD, então é "seguro por padrão": uma rota nova sem decorador já
 * nasce exigindo sessão completa com 2FA, sem ninguém precisar lembrar disso.
 *
 * Ordem das verificações (cada uma só roda se a anterior passou):
 *   1. origem confiável em requisições que alteram estado (CSRF);
 *   2. rota pública? libera;
 *   3. cookie corresponde a uma sessão válida?;
 *   4. nível da rota (qualquer etapa / fluxo do 2FA);
 *   5. sessão completa com 2FA ativo;
 *   6. perfil compatível com @Roles;
 *   7. limite de escritas por usuário.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly limiter: RateLimiter
  ) {}
  async canActivate(host: ExecutionContext) {
    const req = host.switchToHttp().getRequest<AppRequest>();
    // 1) CSRF: toda requisição que altera estado (POST etc.) precisa vir do
    //    próprio site. Vale até para rotas públicas como login e cadastro.
    if (!SAFE_METHODS.includes(req.method)) this.assertTrustedOrigin(req);
    // Lê o nível declarado por @Access (na rota ou, se ausente, no controller).
    const targets = [host.getHandler(), host.getClass()];
    const level = this.reflector.getAllAndOverride<AccessLevel | undefined>(
      ACCESS_KEY,
      targets
    );
    // 2) Rotas públicas não exigem sessão.
    if (level === "public") return true;
    // 3) Demais rotas: o cookie precisa corresponder a uma sessão válida no
    //    servidor (senão, 401). A sessão fica anexada à requisição.
    req.auth = await this.auth.session(req.cookies?.[SESSION_COOKIE]);
    if (level === "any-stage") return true;
    // 4) Rotas do fluxo de 2FA só aceitam sessão parcial (setup/challenge).
    if (level === "partial") {
      if (!["setup", "challenge"].includes(req.auth.stage))
        throw new ForbiddenException("Reinicie o fluxo de autenticação.");
      return true;
    }
    // 5) PADRÃO para todo o resto: exige sessão COMPLETA e 2FA ativo. Uma
    //    senha roubada, sozinha, nunca chega a rotas com dinheiro.
    if (req.auth.stage !== "full" || !req.auth.totp_enabled)
      throw new ForbiddenException("Conclua a autenticação em dois fatores.");
    // 6) Perfil: o master (auditor) só entra em rotas de master, e cliente só
    //    nas de cliente. Separação de funções: quem audita não movimenta.
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets
    );
    if (roles && !roles.includes(req.auth.role))
      throw new ForbiddenException(
        req.auth.role === "master"
          ? "O master tem acesso somente para auditoria."
          : "Acesso restrito ao master."
      );
    // 7) Limite de escritas por usuário (120 por minuto): contém scripts
    //    descontrolados ou uma sessão sequestrada tentando operar em massa.
    if (!SAFE_METHODS.includes(req.method))
      await this.limiter.throttle(`write:${req.auth.user_id}`, 120, 60);
    return true;
  }
  /**
   * Defesa contra CSRF (um site malicioso fazendo o navegador da vítima enviar
   * requisições à API). Exige duas coisas que um site de terceiros não consegue
   * produzir juntas: o cabeçalho Origin igual a uma origem permitida e o
   * cabeçalho personalizado X-Wallet-Request. É uma camada ADICIONAL ao cookie
   * SameSite=Strict.
   */
  private assertTrustedOrigin(req: AppRequest) {
    const origins = (process.env.APP_ORIGINS || "http://localhost:3080").split(
      ","
    );
    if (
      !origins.includes(req.headers.origin as string) ||
      req.headers["x-wallet-request"] !== "1"
    )
      throw new ForbiddenException("Origem da solicitação não autorizada.");
  }
}
