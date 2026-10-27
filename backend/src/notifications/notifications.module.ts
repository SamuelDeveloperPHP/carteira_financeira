import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";

/**
 * Avisos ao usuário. Exporta o serviço para que o módulo da carteira crie os
 * avisos dentro da transação da transferência e da devolução.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
