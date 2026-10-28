import { Module } from "@nestjs/common";
import { InsightsController } from "./insights.controller";
import { InsightsRepository } from "./insights.repository";
import { InsightsService } from "./insights.service";

/** Indicadores, gráficos e sugestões (BI) sobre as movimentações do usuário. */
@Module({
  controllers: [InsightsController],
  providers: [InsightsService, InsightsRepository],
})
export class InsightsModule {}
