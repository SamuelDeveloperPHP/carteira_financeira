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
    // Swap this binding for a bank/payment provider when real money is added.
    { provide: DEPOSIT_PROVIDER, useClass: SimulatedDepositProvider },
  ],
  exports: [WalletService, DepositsService],
})
export class WalletModule {}
