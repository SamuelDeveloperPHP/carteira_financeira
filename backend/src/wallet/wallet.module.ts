import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { DEPOSIT_PROVIDER, SimulatedDepositProvider } from "./deposit.provider";
import { DepositsService } from "./deposits.service";
import { IdempotencyRepository } from "./idempotency.repository";
import { IdempotencyService } from "./idempotency.service";
import { LedgerRepository } from "./ledger.repository";
import { LedgerService } from "./ledger.service";
import { TransfersService } from "./transfers.service";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

/**
 * Tudo que envolve dinheiro. Camadas, de baixo para cima:
 *   LedgerRepository / IdempotencyRepository  -> SQL
 *   LedgerService, IdempotencyService          -> regras reutilizáveis (razão, repetição segura)
 *   TransfersService, DepositsService          -> casos de uso (cada um uma transação)
 *   WalletService                              -> leitura (saldo, extrato)
 *   WalletController                           -> HTTP
 */
@Module({
  imports: [UsersModule],
  controllers: [WalletController],
  providers: [
    LedgerRepository,
    LedgerService,
    IdempotencyRepository,
    IdempotencyService,
    TransfersService,
    DepositsService,
    WalletService,
    // Inversão de dependência: DepositsService pede "um DEPOSIT_PROVIDER" (a
    // interface), e este é o ÚNICO lugar que escolhe qual classe concreta entrega.
    // Para integrar um banco ou gateway de pagamento real, troca-se só esta linha.
    { provide: DEPOSIT_PROVIDER, useClass: SimulatedDepositProvider },
  ],
  // Exportados para o AdminModule (extrato do master) e para o comando do operador (depósito).
  exports: [WalletService, DepositsService],
})
export class WalletModule {}
