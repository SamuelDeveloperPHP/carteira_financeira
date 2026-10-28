import { Controller, Get, Query, Req } from "@nestjs/common";
import { PageQueryDto } from "../common/dto/page-query.dto";
import { Roles } from "../common/http/access.decorators";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { AccessService } from "./access.service";

/** Trilha de acesso do usuário logado. O dono vem sempre da sessão. */
@Controller("access")
@Roles("user")
export class AccessController {
  constructor(private readonly access: AccessService) {}

  /** Histórico paginado de logins (com duração e localização). */
  @Get()
  list(@Query() query: PageQueryDto, @Req() req: AppRequest) {
    const s = sessionOf(req);
    return this.access.list(s.user_id, s.token_hash, query.page);
  }

  /** Pontos do mapa geral: acessos que têm coordenadas. */
  @Get("map")
  map(@Req() req: AppRequest) {
    const s = sessionOf(req);
    return this.access.map(s.user_id, s.token_hash);
  }
}
