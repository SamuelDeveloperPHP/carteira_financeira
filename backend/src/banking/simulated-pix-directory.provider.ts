import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PixDecision,
  PixDirectoryProvider,
  PixSubmission,
} from "./pix-directory.provider";
import { needsOwnershipProof } from "./pix-key.rules";

/**
 * DICT SIMULADO, só para demonstração. Reproduz o fluxo de aprovação do arranjo:
 *   CPF/CNPJ/aleatória -> aprovada na hora (o documento já foi conferido com o titular);
 *   e-mail/telefone    -> fica "aguardando prova de posse" até o código chegar.
 * Com DEMO_MAIL=true o código aparece no log da API (como o link de senha).
 *
 * Um provedor real implementaria `PixDirectoryProvider` chamando o DICT por meio
 * da instituição participante, e substituiria esta classe no BankingModule.
 */
@Injectable()
export class SimulatedPixDirectory implements PixDirectoryProvider {
  readonly name = "simulation";

  async submit(request: PixSubmission): Promise<PixDecision> {
    const protocol = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    return needsOwnershipProof(request.type)
      ? { status: "awaiting_ownership", protocol }
      : { status: "approved", protocol };
  }

  async sendOwnershipCode(type: string, value: string, code: string) {
    if (process.env.DEMO_MAIL !== "true") return;
    console.log(
      JSON.stringify({
        event: "pix.ownership_code.simulated",
        channel: type === "email" ? "email" : "sms",
        to: value,
        code,
      })
    );
  }

  async confirm(protocol: string): Promise<PixDecision> {
    return { status: "approved", protocol };
  }
}
