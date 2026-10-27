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
import { DepositsService } from "./deposits.service";
import { DepositDto, RefundDto, TransferDto } from "./dto/wallet.dto";
import { TransfersService } from "./transfers.service";
import { Movement } from "./wallet.types";
import { WalletService } from "./wallet.service";

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException("Identificador inválido."),
});

/**
 * Anexa uma mensagem em português ao movimento devolvido. O frontend a exibe
 * como está, então o texto de cada resultado fica no servidor, em um lugar só,
 * e qualquer outro cliente da API recebe a mesma mensagem.
 */
const withMessage = (movement: Movement, message: string) => ({
  ...movement,
  message,
});

/**
 * Endpoints da carteira para usuários comuns. O id do usuário vem SEMPRE da
 * sessão, nunca da requisição, então ninguém age sobre a carteira de outra
 * pessoa. Rotas que movem dinheiro exigem o cabeçalho Idempotency-Key.
 */
@Controller()
@Roles("user")
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly transfers: TransfersService,
    private readonly deposits: DepositsService
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

  /** Adiciona saldo (simulado) à carteira de quem está logado. */
  @Post("deposits")
  async deposit(
    @Body() dto: DepositDto,
    @IdempotencyKey() key: string,
    @Req() req: AppRequest
  ) {
    const movement = await this.deposits.selfDeposit(
      sessionOf(req).user_id,
      dto,
      key,
      auditContext(req)
    );
    return withMessage(movement, "Saldo adicionado à sua carteira.");
  }

  @Post("transfers")
  async transfer(
    @Body() dto: TransferDto,
    @IdempotencyKey() key: string,
    @Req() req: AppRequest
  ) {
    const movement = await this.transfers.transfer(
      sessionOf(req).user_id,
      dto,
      key,
      auditContext(req)
    );
    return withMessage(movement, "Transferência concluída.");
  }

  @Post("transfers/:id/refund")
  async refund(
    @Param("id", uuidPipe) id: string,
    @Body() _body: RefundDto,
    @IdempotencyKey() key: string,
    @Req() req: AppRequest
  ) {
    // Associa o evento de auditoria (inclusive de uma recusa) à transferência alvo.
    req.targetResource = id;
    const movement = await this.transfers.refund(
      sessionOf(req).user_id,
      id,
      key,
      auditContext(req)
    );
    return withMessage(movement, "Valor devolvido integralmente ao remetente.");
  }
}
