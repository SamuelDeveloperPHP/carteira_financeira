import { Body, Controller, Get, Patch, Post, Req } from "@nestjs/common";
import { Roles } from "../common/http/access.decorators";
import { auditContext } from "../common/http/request-context";
import { AppRequest, sessionOf } from "../common/http/request.types";
import { DisableFaceDto, EnrollFaceDto, UpdateSettingsDto } from "./dto/settings.dto";
import { FaceService } from "./face.service";
import { SettingsService } from "./settings.service";

/** Preferências de segurança e reconhecimento facial do usuário logado. */
@Controller("settings")
@Roles("user")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly face: FaceService
  ) {}

  @Get()
  get(@Req() req: AppRequest) {
    return this.settings.get(sessionOf(req).user_id);
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto, @Req() req: AppRequest) {
    return this.settings.update(sessionOf(req).user_id, dto, auditContext(req));
  }

  @Post("face")
  enroll(@Body() dto: EnrollFaceDto, @Req() req: AppRequest) {
    return this.face.enroll(sessionOf(req).user_id, dto, auditContext(req));
  }

  @Post("face/disable")
  disable(@Body() dto: DisableFaceDto, @Req() req: AppRequest) {
    return this.face.disable(sessionOf(req).user_id, dto, auditContext(req));
  }
}
