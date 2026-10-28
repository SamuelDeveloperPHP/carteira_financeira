import { Module } from "@nestjs/common";
import { BankingController } from "./banking.controller";
import { BankingRepository } from "./banking.repository";
import { BankingService } from "./banking.service";
import { PIX_DIRECTORY } from "./pix-directory.provider";
import { SimulatedPixDirectory } from "./simulated-pix-directory.provider";

/**
 * Contas bancárias e chaves Pix. O diretório do Pix entra por token
 * (PIX_DIRECTORY): trocar a simulação pelo DICT real é mudar a linha abaixo.
 */
@Module({
  controllers: [BankingController],
  providers: [
    BankingService,
    BankingRepository,
    { provide: PIX_DIRECTORY, useClass: SimulatedPixDirectory },
  ],
})
export class BankingModule {}
