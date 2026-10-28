import { Controller, Get, Query, Req } from "@nestjs/common";
import { Roles } from "../common/http/access.decorators";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { InsightsQueryDto } from "./dto/insights.dto";
import { InsightsService } from "./insights.service";

/** BI da carteira do usuário logado. O dono vem sempre da sessão. Exclusivo de clientes. */
@Controller("insights")
@Roles("user")
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  overview(@Query() query: InsightsQueryDto, @Req() req: AppRequest) {
    return this.insights.overview(sessionOf(req).user_id, query.period);
  }
}
