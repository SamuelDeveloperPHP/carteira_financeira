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
import { AppRequest, sessionOf } from "../common/http/request.types";
import { EmptyBodyDto } from "./dto/notifications.dto";
import { NotificationsService } from "./notifications.service";

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException("Identificador inválido."),
});

/**
 * Notificações do usuário logado. O id do usuário vem SEMPRE da sessão, então
 * cada pessoa só lê e altera os próprios avisos. Rota exclusiva de clientes
 * comuns (o master não tem carteira nem recebe dinheiro).
 *
 * Não gera evento de auditoria: ler um aviso não altera dinheiro nem dado
 * sensível, e o aviso em si já deriva de um movimento auditado.
 */
@Controller("notifications")
@Roles("user")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Lista paginada de avisos NÃO lidos. */
  @Get()
  list(@Query() query: PageQueryDto, @Req() req: AppRequest) {
    return this.notifications.list(sessionOf(req).user_id, query.page);
  }

  /** Apenas quantos avisos não lidos existem (alimenta o sino). */
  @Get("count")
  count(@Req() req: AppRequest) {
    return this.notifications.unread(sessionOf(req).user_id);
  }

  /** Marca todos como lidos. Declarada antes de ":id/read" por clareza. */
  @Post("read-all")
  readAll(@Body() _body: EmptyBodyDto, @Req() req: AppRequest) {
    return this.notifications.markAllRead(sessionOf(req).user_id);
  }

  /** Marca um aviso como lido; ele some da lista. */
  @Post(":id/read")
  read(
    @Param("id", uuidPipe) id: string,
    @Body() _body: EmptyBodyDto,
    @Req() req: AppRequest
  ) {
    return this.notifications.markRead(sessionOf(req).user_id, id);
  }
}
