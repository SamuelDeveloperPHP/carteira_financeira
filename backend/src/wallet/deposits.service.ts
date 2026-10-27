import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { Database } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { logUnexpected } from "../common/logging/failure-log";
import { digest } from "../common/security/crypto";
import { email, idempotencyKey, money } from "../common/security/validation";
import { UsersRepository } from "../users/users.repository";
import { DEPOSIT_PROVIDER, DepositProvider } from "./deposit.provider";
import { IdempotencyService } from "./idempotency.service";
import { LedgerService } from "./ledger.service";
import { Movement } from "./wallet.types";

/**
 * Credita uma carteira DEPOIS que um provedor externo confirma o pagamento.
 *
 * Não é exposto por HTTP: só o comando local do operador chama este serviço.
 * Assim nenhum usuário, nem um invasor com sessão válida, consegue criar saldo.
 * O depósito é a única forma de o dinheiro ENTRAR no sistema; transferências e
 * devoluções apenas o movem. Por isso a soma dos depósitos é a referência da
 * conciliação.
 */
@Injectable()
export class DepositsService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(DEPOSIT_PROVIDER) private readonly provider: DepositProvider
  ) {}

  /**
   * @param referenceValue referência única do provedor. Serve também como chave
   *   de idempotência: confirmar o mesmo pagamento duas vezes credita uma só.
   * @param provider substituível nos testes; por padrão usa o provedor injetado.
   *
   * Entradas chegam como `unknown` (linha de comando, sem DTO), por isso são
   * validadas aqui com as mesmas regras do restante do sistema.
   */
  async deposit(
    emailValue: unknown,
    amountValue: unknown,
    referenceValue: unknown,
    ctx: AuditContext,
    provider: DepositProvider = this.provider
  ): Promise<Movement> {
    const recipientEmail = email(emailValue),
      amount = money(amountValue),
      reference = idempotencyKey(referenceValue);
    // A confirmação externa acontece ANTES de abrir a transação: não se deve
    // segurar uma transação (e bloqueios) esperando uma chamada de rede lenta.
    try {
      await provider.confirm(reference);
    } catch (error) {
      // Uma recusa deliberada (ex.: provedor desabilitado, 403) mantém seu status.
      if (error instanceof HttpException) throw error;
      // Falha inesperada (provedor fora do ar): vira 503 e NADA é creditado,
      // pois sem confirmação não há dinheiro.
      logUnexpected("deposit.provider.failed", ctx.correlationId, error, {
        provider: provider.name,
      });
      throw new ServiceUnavailableException(
        "Não foi possível confirmar o pagamento com o provedor."
      );
    }
    const scope = `deposit:${provider.name}`,
      fingerprint = digest(JSON.stringify([recipientEmail, amount]));
    return this.db.transaction(async tx => {
      const previous = await this.idempotency.replay(
        tx,
        scope,
        reference,
        fingerprint
      );
      if (previous) {
        await this.audit.record(
          "deposit.replayed",
          null,
          previous.id,
          ctx,
          { provider: provider.name },
          "success",
          null,
          tx
        );
        return previous;
      }
      const recipientId = await this.users.findCustomerIdByEmail(
        recipientEmail,
        tx
      );
      if (!recipientId)
        throw new NotFoundException("Carteira destinatária não encontrada.");
      const movement = await this.ledger.post(tx, {
        kind: "deposit",
        senderId: null,
        recipientId,
        amount,
        originalId: null,
        reference,
      });
      await this.idempotency.remember(
        tx,
        scope,
        reference,
        fingerprint,
        movement.id
      );
      await this.audit.record(
        "deposit.completed",
        null,
        movement.id,
        ctx,
        { recipientId, provider: provider.name, amount },
        "success",
        null,
        tx
      );
      return movement;
    });
  }
}
