import { Controller, Get } from "@nestjs/common";
import { Database } from "../common/database/database.service";
import { Access } from "../common/http/access.decorators";

@Controller("health")
export class HealthController {
  constructor(private readonly db: Database) {}
  @Access("public") @Get()
  async health() {
    await this.db.pool.query("SELECT 1");
    return { status: "ok", mode: "simulation" };
  }
}
