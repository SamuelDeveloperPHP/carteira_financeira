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
 * Credits a wallet after an external payment provider confirms the money.
 * Not exposed over HTTP: only the local operator command calls this, so no
 * end user can create balance.
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
   * @param referenceValue provider's unique reference; doubles as idempotency
   *   key, so confirming the same payment twice credits it once.
   * @param provider overridable for tests; defaults to the injected provider.
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
    try {
      await provider.confirm(reference);
    } catch (error) {
      // A deliberate refusal (e.g. provider not enabled) keeps its own status.
      if (error instanceof HttpException) throw error;
      // No money is credited unless the provider confirmed the payment.
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
