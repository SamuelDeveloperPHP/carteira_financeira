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

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly limiter: RateLimiter
  ) {}
  async canActivate(host: ExecutionContext) {
    const req = host.switchToHttp().getRequest<AppRequest>();
    if (!SAFE_METHODS.includes(req.method)) this.assertTrustedOrigin(req);
    const targets = [host.getHandler(), host.getClass()];
    const level = this.reflector.getAllAndOverride<AccessLevel | undefined>(
      ACCESS_KEY,
      targets
    );
    if (level === "public") return true;
    req.auth = await this.auth.session(req.cookies?.[SESSION_COOKIE]);
    if (level === "any-stage") return true;
    if (level === "partial") {
      if (!["setup", "challenge"].includes(req.auth.stage))
        throw new ForbiddenException("Reinicie o fluxo de autenticação.");
      return true;
    }
    if (req.auth.stage !== "full" || !req.auth.totp_enabled)
      throw new ForbiddenException("Conclua a autenticação em dois fatores.");
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
    if (req.method === "POST")
      await this.limiter.throttle(`write:${req.auth.user_id}`, 120, 60);
    return true;
  }
  // State-changing requests must come from the app itself (CSRF defence in depth
  // on top of SameSite=Strict cookies).
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
