import { Module } from "@nestjs/common";
import { AccessLogRepository } from "./access-log.repository";
import { AccessController } from "./access.controller";
import { AccessService } from "./access.service";

/** Trilha de acesso (login/logout, duração e localização). Exporta o repositório para o AuthService abrir registros. */
@Module({
  controllers: [AccessController],
  providers: [AccessService, AccessLogRepository],
  exports: [AccessLogRepository],
})
export class AccessModule {}
