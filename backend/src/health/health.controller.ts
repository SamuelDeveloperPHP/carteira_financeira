import { Controller, Get } from "@nestjs/common";
import { Database } from "../common/database/database.service";
import { Access } from "../common/http/access.decorators";

/**
 * Verificação de saúde usada pelo Docker (healthcheck) e por monitoramento.
 * É pública, mas não revela nada sensível: apenas confirma que a API responde e
 * alcança o banco.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly db: Database) {}
  @Access("public") @Get()
  async health() {
    // Consulta mínima: se o banco estiver fora, a exceção vira 500 e o
    // orquestrador marca o container como não saudável.
    await this.db.pool.query("SELECT 1");
    return { status: "ok", mode: "simulation" };
  }
}
