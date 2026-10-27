import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/** Verificação de saúde da API (rota /api/health), usada pelo Docker e por monitoramento. Módulo mínimo e sem dependências além do banco global. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
