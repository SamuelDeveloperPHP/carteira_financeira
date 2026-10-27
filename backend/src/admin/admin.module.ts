import { Module } from "@nestjs/common";
import { WalletModule } from "../wallet/wallet.module";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";

/**
 * Área do master (auditor). Importa o WalletModule só para reaproveitar o
 * `WalletService` (leitura de extrato): o master vê os extratos pela mesma regra
 * de paginação do usuário, sem duplicar SQL. Não exporta nada, pois nenhum outro
 * módulo depende dele.
 */
@Module({
  imports: [WalletModule],
  controllers: [AdminController],
  providers: [AdminRepository, AdminService],
})
export class AdminModule {}
