import { Injectable } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { Database } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { UpdateSettingsDto } from "./dto/settings.dto";
import { SettingsRepository } from "./settings.repository";

/**
 * Preferências de segurança do usuário.
 *
 *   biometria     : sinalizador para o aplicativo nativo. O servidor guarda só a
 *                   preferência; a biometria do aparelho nunca chega aqui.
 *   geolocalização: quando desligada, o servidor descarta a localização enviada
 *                   no login (ver `geolocationAllowed`, usado pelo AuthService).
 *   rosto         : ligado/desligado por FaceService (exige senha e prova de vida).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: Database,
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService
  ) {}

  async get(userId: string) {
    const s = await this.repo.get(userId);
    return {
      biometricEnabled: s.biometric_enabled,
      geolocationEnabled: s.geolocation_enabled,
      faceEnabled: s.face_enabled,
    };
  }

  async update(userId: string, dto: UpdateSettingsDto, ctx: AuditContext) {
    await this.db.transaction(async tx => {
      await this.repo.update(tx, userId, {
        biometric: dto.biometricEnabled,
        geolocation: dto.geolocationEnabled,
      });
      await this.audit.record(
        "settings.updated",
        userId,
        userId,
        ctx,
        {
          biometric: dto.biometricEnabled,
          geolocation: dto.geolocationEnabled,
        },
        "success",
        null,
        tx
      );
    });
    return { ...(await this.get(userId)), message: "Preferências salvas." };
  }

  /** O usuário aceita registrar a localização dos acessos? */
  async geolocationAllowed(userId: string): Promise<boolean> {
    return (await this.repo.get(userId)).geolocation_enabled;
  }
}
