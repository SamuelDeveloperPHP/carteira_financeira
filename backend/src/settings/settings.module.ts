import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { FaceService } from "./face.service";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

/**
 * Preferências de segurança (biometria, geolocalização) e reconhecimento facial.
 * Exporta os serviços para o módulo de autenticação: o login consulta a
 * geolocalização e a recuperação de senha exige o rosto quando ativado.
 */
@Module({
  imports: [UsersModule],
  controllers: [SettingsController],
  providers: [SettingsService, FaceService, SettingsRepository],
  exports: [SettingsService, FaceService],
})
export class SettingsModule {}
