import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  Param,
  Query,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Database } from "./db";
import { Audit } from "./audit";
import { Auth } from "./auth";
import { Wallet } from "./wallet";
import { Admin } from "./admin";
import * as S from "./security";

@Injectable()
class AccessGuard implements CanActivate {
  constructor(private readonly auth: Auth) {}
  async canActivate(host: ExecutionContext) {
    const req = host.switchToHttp().getRequest();
    const path = req.path.replace(/\/$/, "");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origins = (
        process.env.APP_ORIGINS || "http://localhost:3080"
      ).split(",");
      if (
        !origins.includes(req.headers.origin) ||
        req.headers["x-wallet-request"] !== "1"
      )
        throw new ForbiddenException("Origem da solicitação não autorizada.");
    }
    if (["/api/health", "/api/auth/register", "/api/auth/login"].includes(path))
      return true;
    req.auth = await this.auth.session(req.cookies?.wallet_session);
    if (path === "/api/auth/status" || path === "/api/auth/logout") return true;
    if (["/api/auth/setup", "/api/auth/verify"].includes(path)) {
      if (!["setup", "challenge"].includes(req.auth.stage))
        throw new ForbiddenException("Reinicie o fluxo de autenticação.");
      return true;
    }
    if (req.auth.stage !== "full" || !req.auth.totp_enabled)
      throw new ForbiddenException("Conclua a autenticação em dois fatores.");
    if (path.startsWith("/api/admin") && req.auth.role !== "master")
      throw new ForbiddenException("Acesso restrito ao master.");
    if (req.method === "POST")
      await this.auth.throttle(`write:${req.auth.user_id}`, 120, 60);
    return true;
  }
}

@Catch()
class Errors implements ExceptionFilter {
  constructor(private readonly audit: Audit) {}
  async catch(error: any, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest(),
      res = host.switchToHttp().getResponse();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message =
      error instanceof HttpException
        ? error.message
        : "Não foi possível concluir. Tente novamente usando a mesma solicitação.";
    try {
      await this.audit.record(
        `${req.method} ${req.path}`,
        req.auth?.user_id || null,
        req.targetResource || null,
        S.context(req),
        {},
        status < 500 ? "denied" : "failure",
        status < 500 ? message : "internal_error"
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "audit.write.failed",
          correlationId: req.correlationId,
        })
      );
    }
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request.failed",
          correlationId: req.correlationId,
          errorType: error?.constructor?.name,
          code: error?.code,
        })
      );
    res.status(status).json({ message, correlationId: req.correlationId });
  }
}

@Controller()
class Api {
  constructor(
    private readonly auth: Auth,
    private readonly wallet: Wallet,
    private readonly admin: Admin,
    private readonly db: Database,
    private readonly audit: Audit
  ) {}
  private session(result: any, res: any) {
    const { cookie, ...publicData } = result;
    res.cookie("wallet_session", cookie, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      path: "/api",
      maxAge: result.stage === "full" ? 8 * 3600000 : 600000,
    });
    return publicData;
  }
  @Get("health") async health() {
    await this.db.pool.query("SELECT 1");
    return { status: "ok", mode: "simulation" };
  }
  @Post("auth/register") register(@Body() b: unknown, @Req() req: any) {
    return this.auth.register(b, req);
  }
  @Post("auth/login") async login(
    @Body() b: unknown,
    @Req() req: any,
    @Res({ passthrough: true }) res: any
  ) {
    return this.session(await this.auth.login(b, req), res);
  }
  @Get("auth/status") status(@Req() req: any) {
    return {
      stage: req.auth.stage,
      user:
        req.auth.stage === "full"
          ? {
              id: req.auth.user_id,
              name: req.auth.name,
              email: req.auth.email,
              role: req.auth.role,
            }
          : null,
    };
  }
  @Get("auth/setup") setup(@Req() req: any) {
    return this.auth.setup(req);
  }
  @Post("auth/verify") async verify(
    @Body() b: unknown,
    @Req() req: any,
    @Res({ passthrough: true }) res: any
  ) {
    return this.session(await this.auth.verify(b, req), res);
  }
  @Post("auth/rotate") async rotate(
    @Body() b: unknown,
    @Req() req: any,
    @Res({ passthrough: true }) res: any
  ) {
    return this.session(await this.auth.rotate(b, req), res);
  }
  @Post("auth/logout") async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any
  ) {
    const result = await this.auth.logout(req);
    res.clearCookie("wallet_session", {
      path: "/api",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
    });
    return result;
  }
  @Get("wallet") balance(@Req() req: any) {
    return this.wallet.balance(req);
  }
  @Get("wallet/statement") async statement(@Query() q: any, @Req() req: any) {
    S.object(q, ["page"]);
    if (req.auth.role !== "user")
      throw new ForbiddenException("Acesse a auditoria.");
    await this.audit.record(
      "wallet.statement.view",
      req.auth.user_id,
      req.auth.user_id,
      S.context(req),
      { page: S.page(q.page) }
    );
    return this.wallet.statement(req.auth.user_id, q.page);
  }
  @Post("transfers") transfer(@Body() b: unknown, @Req() req: any) {
    return this.wallet.transfer(b, req.headers["idempotency-key"], req);
  }
  @Post("transfers/:id/refund") refund(
    @Param("id") id: string,
    @Body() b: unknown,
    @Req() req: any
  ) {
    S.object(b || {}, []);
    return this.wallet.refund(id, req.headers["idempotency-key"], req);
  }
  @Get("admin/users") users(@Query() q: any, @Req() req: any) {
    return this.admin.users(q, req);
  }
  @Get("admin/users/:id/statement") userStatement(
    @Param("id") id: string,
    @Query() q: any,
    @Req() req: any
  ) {
    return this.admin.statement(id, q, req);
  }
  @Get("admin/events") events(@Query() q: any, @Req() req: any) {
    return this.admin.events(q, req);
  }
  @Get("admin/movements/:id") movement(
    @Param("id") id: string,
    @Req() req: any
  ) {
    return this.admin.movement(id, req);
  }
  @Get("admin/metrics") metrics(@Req() req: any) {
    return this.admin.metrics(req);
  }
}

@Module({
  controllers: [Api],
  providers: [Database, Audit, Auth, Wallet, Admin, AccessGuard],
})
export class AppModule {}
export async function createApp() {
  if (
    !process.env.DATABASE_URL ||
    !/^[a-f0-9]{64}$/.test(process.env.TOTP_ENCRYPTION_KEY || "")
  )
    throw new Error("Missing secure runtime configuration");
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api");
  // Only the private gateway is published. It overwrites forwarded IP headers.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    req.correlationId = randomUUID();
    res.setHeader("X-Request-Id", req.correlationId);
    res.setHeader("Cache-Control", "no-store");
    const start = Date.now();
    res.on("finish", () => {
      if (req.path !== "/api/health")
        console.log(
          JSON.stringify({
            event: "http.request",
            correlationId: req.correlationId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - start,
          })
        );
    });
    next();
  });
  app.useGlobalGuards(app.get(AccessGuard));
  app.useGlobalFilters(new Errors(app.get(Audit)));
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  createApp()
    .then(app => app.listen(Number(process.env.PORT || 3001), "0.0.0.0"))
    .catch(() => {
      console.error("API startup failed");
      process.exitCode = 1;
    });
