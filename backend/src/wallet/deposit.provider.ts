import { ForbiddenException, Injectable } from "@nestjs/common";
import { text } from "../common/security/validation";

/**
 * Fronteira com quem CONFIRMA que o dinheiro realmente chegou (um banco, um
 * gateway de pagamento). O serviço de depósito só conhece esta interface e só
 * credita depois que `confirm` termina sem erro.
 *
 * Para integrar um provedor real basta uma nova classe que implemente esta
 * interface e uma troca de binding no WalletModule. Um provedor real ainda
 * exigiria contrato, confirmação autenticada (webhook assinado) e conciliação
 * com o extrato externo; isso não está implementado.
 */
export interface DepositProvider {
  readonly name: string;
  /** Lança exceção se o pagamento não puder ser confirmado. */
  confirm(reference: string): Promise<void>;
}

/** Token de injeção (interfaces não existem em tempo de execução). */
export const DEPOSIT_PROVIDER = Symbol("DEPOSIT_PROVIDER");

/**
 * Provedor SIMULADO, só para demonstração: não confirma nada com um banco. Fica
 * DESLIGADO por padrão e só funciona com DEMO_DEPOSITS=true, para que uma
 * instalação fora da demonstração nunca consiga criar saldo do nada.
 */
@Injectable()
export class SimulatedDepositProvider implements DepositProvider {
  readonly name = "simulation";
  async confirm(reference: string) {
    if (process.env.DEMO_DEPOSITS !== "true")
      throw new ForbiddenException("Depósitos simulados desabilitados.");
    // Valida o formato da referência, como um provedor real faria.
    text(reference, 8, 100);
  }
}
