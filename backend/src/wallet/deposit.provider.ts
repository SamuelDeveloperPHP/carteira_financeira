import { ForbiddenException, Injectable } from "@nestjs/common";
import { text } from "../common/security/validation";

// Boundary to whatever confirms that money really arrived. Swapping the binding
// in WalletModule is all it takes to plug in a bank or payment provider.
export interface DepositProvider {
  readonly name: string;
  confirm(reference: string): Promise<void>;
}

export const DEPOSIT_PROVIDER = Symbol("DEPOSIT_PROVIDER");

// Demonstration only: not a bank confirmation, and disabled outside the demo.
@Injectable()
export class SimulatedDepositProvider implements DepositProvider {
  readonly name = "simulation";
  async confirm(reference: string) {
    if (process.env.DEMO_DEPOSITS !== "true")
      throw new ForbiddenException("Depósitos simulados desabilitados.");
    text(reference, 8, 100);
  }
}
