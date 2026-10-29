import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from "@nestjs/common";
import { PageQueryDto } from "../common/dto/page-query.dto";
import { Roles } from "../common/http/access.decorators";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { AdminService } from "./admin.service";
import { EventsQueryDto, UsersQueryDto } from "./dto/admin.dto";

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException("Identificador inválido."),
});

/**
 * Endpoints de auditoria exclusivos do master. Todas as rotas são GET: nenhuma
 * altera dados. `@Roles("master")` na classe vale para todas; o guard barra
 * clientes comuns com 403. Os UUIDs de rota são validados antes de chegar ao serviço.
 */
@Controller("admin")
@Roles("master")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("users")
  users(@Query() q: UsersQueryDto, @Req() req: AppRequest) {
    return this.admin.users(q, sessionOf(req).user_id, auditContext(req));
  }

  @Get("users/:id/statement")
  statement(
    @Param("id", uuidPipe) id: string,
    @Query() q: PageQueryDto,
    @Req() req: AppRequest
  ) {
    return this.admin.statement(
      id,
      q,
      sessionOf(req).user_id,
      auditContext(req)
    );
  }

  @Get("events")
  events(@Query() q: EventsQueryDto, @Req() req: AppRequest) {
    return this.admin.searchEvents(
      q,
      sessionOf(req).user_id,
      auditContext(req)
    );
  }

  @Get("movements/:id")
  movement(@Param("id", uuidPipe) id: string, @Req() req: AppRequest) {
    return this.admin.movement(id, sessionOf(req).user_id, auditContext(req));
  }

  @Get("metrics")
  metrics(@Req() req: AppRequest) {
    return this.admin.metrics(sessionOf(req).user_id, auditContext(req));
  }
}
