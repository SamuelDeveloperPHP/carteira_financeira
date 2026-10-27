import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { FULL_SESSION_MINUTES, PARTIAL_SESSION_MINUTES, SESSION_COOKIE } from "../common/constants";
import { Access } from "../common/http/access.decorators";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { AuthService } from "./auth.service";
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  RotateDto,
  VerifyDto,
} from "./dto/auth.dto";
import { PasswordRecoveryService } from "./password-recovery.service";
import { TwoFactorService } from "./two-factor.service";

/** HttpOnly (no JS access), SameSite=Strict (no cross-site sends); Secure behind HTTPS. */
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/api",
});

/**
 * HTTP layer for authentication: translates requests into service calls and
 * owns the session cookie. No business rule lives here. Each route declares
 * its access level; without `@Access` it needs a fully authenticated session.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly recovery: PasswordRecoveryService
  ) {}

  /** The opaque session token only ever travels in an HttpOnly cookie, never in the body. */
  private withSession<T extends { cookie: string; stage: string }>(
    result: T,
    res: Response
  ): Omit<T, "cookie"> {
    const { cookie, ...publicData } = result;
    const minutes =
      result.stage === "full" ? FULL_SESSION_MINUTES : PARTIAL_SESSION_MINUTES;
    res.cookie(SESSION_COOKIE, cookie, {
      ...cookieOptions(),
      maxAge: minutes * 60000,
    });
    return publicData;
  }

  @Access("public") @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: AppRequest) {
    return this.auth.register(dto, req);
  }

  @Access("public") @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.auth.login(dto, req), res);
  }

  @Access("public") @Post("forgot-password")
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: AppRequest) {
    return this.recovery.forgot(dto, req);
  }

  @Access("public") @Post("reset-password")
  reset(@Body() dto: ResetPasswordDto, @Req() req: AppRequest) {
    return this.recovery.reset(dto, req);
  }

  /** Lets the frontend discover which step of the login the cookie is at. */
  @Access("any-stage") @Get("status")
  status(@Req() req: AppRequest) {
    const auth = sessionOf(req);
    return {
      stage: auth.stage,
      user:
        auth.stage === "full"
          ? {
              id: auth.user_id,
              name: auth.name,
              email: auth.email,
              role: auth.role,
            }
          : null,
    };
  }

  @Access("partial") @Get("setup")
  setup(@Req() req: AppRequest) {
    return this.twoFactor.setup(req);
  }

  @Access("partial") @Post("verify")
  async verify(
    @Body() dto: VerifyDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.auth.verify(dto, req), res);
  }

  /** Replaces the authenticator; needs a full session, password and a valid code. */
  @Post("rotate")
  async rotate(
    @Body() dto: RotateDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.twoFactor.rotate(dto, req), res);
  }

  @Access("any-stage") @Post("logout")
  async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.auth.logout(req);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return result;
  }
}
