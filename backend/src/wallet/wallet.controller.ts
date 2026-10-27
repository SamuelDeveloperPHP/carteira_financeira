import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PageQueryDto } from "../common/dto/page-query.dto";
import { Roles } from "../common/http/access.decorators";
import { IdempotencyKey } from "../common/http/idempotency-key.decorator";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { RefundDto, TransferDto } from "./dto/wallet.dto";
import { TransfersService } from "./transfers.service";
import { WalletService } from "./wallet.service";

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException("Identificador inválido."),
});

/**
 * Wallet endpoints for ordinary users. The user id always comes from the
 * session, never from the request, so nobody can act on another wallet.
 * Money-moving routes require an Idempotency-Key header.
 */
@Controller()
@Roles("user")
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly transfers: TransfersService
  ) {}

  @Get("wallet")
  balance(@Req() req: AppRequest) {
    return this.wallet.balance(sessionOf(req).user_id);
  }

  @Get("wallet/statement")
  statement(@Query() query: PageQueryDto, @Req() req: AppRequest) {
    return this.wallet.ownStatement(
      sessionOf(req).user_id,
      query.page,
      auditContext(req)
    );
  }

  @Post("transfers")
  transfer(
    @Body() dto: TransferDto,
    @IdempotencyKey() key: string,
    @Req() req: AppRequest
  ) {
    return this.transfers.transfer(
      sessionOf(req).user_id,
      dto,
      key,
      auditContext(req)
    );
  }

  @Post("transfers/:id/refund")
  refund(
    @Param("id", uuidPipe) id: string,
    @Body() _body: RefundDto,
    @IdempotencyKey() key: string,
    @Req() req: AppRequest
  ) {
    req.targetResource = id;
    return this.transfers.refund(
      sessionOf(req).user_id,
      id,
      key,
      auditContext(req)
    );
  }
}
