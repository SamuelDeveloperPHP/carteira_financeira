import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  FULL_SESSION_MINUTES,
  PARTIAL_SESSION_MINUTES,
  SESSION_COOKIE,
} from "../common/constants";
import { Access } from "../common/http/access.decorators";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { AuthService } from "./auth.service";
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  ResetRequirementsDto,
  RotateDto,
  VerifyDto,
} from "./dto/auth.dto";
import { PasswordRecoveryService } from "./password-recovery.service";
import { TwoFactorService } from "./two-factor.service";

/**
 * Opções do cookie de sessão:
 *   - httpOnly: JavaScript da página não o lê (um XSS não consegue roubá-lo);
 *   - sameSite "strict": o navegador não o envia em requisições vindas de outros
 *     sites (defesa contra CSRF);
 *   - secure: só trafega por HTTPS (ligado com COOKIE_SECURE=true em produção);
 *   - path "/api": só é enviado às rotas da API, não aos arquivos do site.
 */
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/api",
});

/**
 * Camada HTTP da autenticação: traduz requisições em chamadas de serviço e é
 * dona do cookie de sessão. Nenhuma regra de negócio mora aqui (princípio de
 * responsabilidade única: o controller só conversa HTTP).
 *
 * Cada rota declara seu nível de acesso com `@Access`. Sem o decorador, a rota
 * exige sessão completa com 2FA, ou seja, o padrão é o mais restrito.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly recovery: PasswordRecoveryService
  ) {}

  /**
   * O token de sessão só viaja em cookie HttpOnly, NUNCA no corpo da resposta.
   * Este método separa o token do restante dos dados (que são devolvidos ao
   * navegador) e o grava no cookie, com validade conforme o estágio: curta para
   * a sessão parcial, longa para a completa.
   */
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

  @Access("public")
  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: AppRequest) {
    return this.auth.register(dto, req);
  }

  @Access("public")
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.auth.login(dto, req), res);
  }

  @Access("public")
  @Post("forgot-password")
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: AppRequest) {
    return this.recovery.forgot(dto, req);
  }

  @Access("public")
  @Post("reset-requirements")
  resetRequirements(@Body() dto: ResetRequirementsDto, @Req() req: AppRequest) {
    return this.recovery.requirements(dto, req);
  }

  @Access("public")
  @Post("reset-password")
  reset(@Body() dto: ResetPasswordDto, @Req() req: AppRequest) {
    return this.recovery.reset(dto, req);
  }

  /**
   * Informa ao frontend em que ponto do login o cookie está (sem sessão, parcial
   * ou completa). Ao abrir a página, é assim que a tela decide se mostra o
   * login, o QR code do 2FA, o campo do código ou a carteira. Os dados do
   * usuário só são devolvidos quando a sessão é completa.
   */
  @Access("any-stage")
  @Get("status")
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

  // POST e não GET: cria o segredo do autenticador na primeira chamada, e uma
  // leitura (GET) não deve alterar estado nem escapar da checagem de origem.
  @Access("partial")
  @Post("setup")
  setup(@Req() req: AppRequest) {
    return this.twoFactor.setup(req);
  }

  @Access("partial")
  @Post("verify")
  async verify(
    @Body() dto: VerifyDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.auth.verify(dto, req), res);
  }

  /**
   * Troca o autenticador. Exige sessão completa E, no corpo, senha e código
   * válido. Devolve uma sessão "setup" nova (todas as outras são revogadas).
   */
  @Post("rotate")
  async rotate(
    @Body() dto: RotateDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.withSession(await this.twoFactor.rotate(dto, req), res);
  }

  @Access("any-stage")
  @Post("logout")
  async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.auth.logout(req);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return result;
  }
}
