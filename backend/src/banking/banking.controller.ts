import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { Roles } from "../common/http/access.decorators";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { BankingService } from "./banking.service";
import {
  ConfirmPixKeyDto,
  CreateBankAccountDto,
  CreatePixKeyDto,
  EmptyBodyDto,
  UpdatePixKeyDto,
} from "./dto/banking.dto";

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException("Identificador inválido."),
});

/**
 * Dados bancários e chaves Pix. O dono é SEMPRE o usuário da sessão; ids de
 * conta ou chave na URL só valem se pertencerem a ele. Exclusivo de clientes.
 */
@Controller("banking")
@Roles("user")
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Get("banks")
  banks() {
    return this.banking.banks();
  }

  @Get("accounts")
  list(@Req() req: AppRequest) {
    return this.banking.list(sessionOf(req).user_id);
  }

  @Post("accounts")
  add(@Body() dto: CreateBankAccountDto, @Req() req: AppRequest) {
    return this.banking.addAccount(sessionOf(req).user_id, dto, auditContext(req));
  }

  @Delete("accounts/:id")
  remove(@Param("id", uuidPipe) id: string, @Req() req: AppRequest) {
    return this.banking.removeAccount(sessionOf(req).user_id, id, auditContext(req));
  }

  @Post("accounts/:id/pix-keys")
  addKey(
    @Param("id", uuidPipe) id: string,
    @Body() dto: CreatePixKeyDto,
    @Req() req: AppRequest
  ) {
    return this.banking.addKey(sessionOf(req).user_id, id, dto, auditContext(req));
  }

  @Post("pix-keys/:id/confirm")
  confirm(
    @Param("id", uuidPipe) id: string,
    @Body() dto: ConfirmPixKeyDto,
    @Req() req: AppRequest
  ) {
    return this.banking.confirmKey(sessionOf(req).user_id, id, dto, auditContext(req));
  }

  @Post("pix-keys/:id/resend")
  resend(
    @Param("id", uuidPipe) id: string,
    @Body() _body: EmptyBodyDto,
    @Req() req: AppRequest
  ) {
    return this.banking.resendCode(sessionOf(req).user_id, id, auditContext(req));
  }

  @Patch("pix-keys/:id")
  updateKey(
    @Param("id", uuidPipe) id: string,
    @Body() dto: UpdatePixKeyDto,
    @Req() req: AppRequest
  ) {
    return this.banking.updateKey(sessionOf(req).user_id, id, dto, auditContext(req));
  }

  @Delete("pix-keys/:id")
  removeKey(@Param("id", uuidPipe) id: string, @Req() req: AppRequest) {
    return this.banking.removeKey(sessionOf(req).user_id, id, auditContext(req));
  }
}
