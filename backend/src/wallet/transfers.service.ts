import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { Database } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { logUnexpected } from "../common/logging/failure-log";
import { digest } from "../common/security/crypto";
import { UsersRepository } from "../users/users.repository";
import { TransferDto } from "./dto/wallet.dto";
import { IdempotencyService } from "./idempotency.service";
import { LedgerRepository } from "./ledger.repository";
import { LedgerService } from "./ledger.service";
import { Movement } from "./wallet.types";

/**
 * Use cases that move money between two users: transfer and refund.
 * Each runs in a single database transaction, so any failure leaves balances,
 * ledger and audit exactly as they were.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly ledger: LedgerService,
    private readonly movements: LedgerRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService
  ) {}

  /**
   * Sends money from `senderId` to the user owning `dto.recipientEmail`.
   * One transaction: replay check, ledger posting, idempotency record and audit
   * evidence commit together or not at all. Repeating the same `key` with the
   * same data returns the original movement instead of paying twice.
   */
  async transfer(
    senderId: string,
    dto: TransferDto,
    key: string,
    ctx: AuditContext
  ): Promise<Movement> {
    const scope = `transfer:${senderId}`,
      fingerprint = digest(JSON.stringify([dto.recipientEmail, dto.amount]));
    try {
      return await this.db.transaction(async tx => {
        const previous = await this.idempotency.replay(
          tx,
          scope,
          key,
          fingerprint
        );
        if (previous) {
          await this.audit.record(
            "transfer.replayed",
            senderId,
            previous.id,
            ctx,
            {},
            "success",
            null,
            tx
          );
          return previous;
        }
        const recipientId = await this.users.findCustomerIdByEmail(
          dto.recipientEmail,
          tx
        );
        if (!recipientId)
          throw new NotFoundException("Destinatário não encontrado.");
        if (senderId === recipientId)
          throw new BadRequestException(
            "Escolha outra pessoa para transferir."
          );
        const movement = await this.ledger.post(tx, {
          kind: "transfer",
          senderId,
          recipientId,
          amount: dto.amount,
          originalId: null,
          reference: null,
        });
        await this.idempotency.remember(
          tx,
          scope,
          key,
          fingerprint,
          movement.id
        );
        await this.audit.record(
          "transfer.completed",
          senderId,
          movement.id,
          ctx,
          { recipientId, amount: dto.amount },
          "success",
          null,
          tx
        );
        return movement;
      });
    } catch (error) {
      // The transaction was already rolled back. Business refusals travel on to
      // the HTTP filter; anything else is logged with its correlation id.
      logUnexpected("transfer.failed", ctx.correlationId, error, { senderId });
      throw error;
    }
  }

  /**
   * Reverses a transfer. Only the recipient may do it, in full and once, and
   * only while still holding the money (checked by the ledger).
   */
  async refund(
    actorId: string,
    originalId: string,
    key: string,
    ctx: AuditContext
  ): Promise<Movement> {
    const scope = `refund:${actorId}`,
      fingerprint = digest(originalId);
    try {
      return await this.db.transaction(async tx => {
        const previous = await this.idempotency.replay(
          tx,
          scope,
          key,
          fingerprint
        );
        if (previous) {
          await this.audit.record(
            "refund.replayed",
            actorId,
            previous.id,
            ctx,
            {},
            "success",
            null,
            tx
          );
          return previous;
        }
        // Movements are immutable (no UPDATE privilege), so refunds of the same
        // transfer are serialised by a lock on the original id.
        await this.idempotency.lockOriginal(tx, originalId);
        const original = await this.movements.findMovement(tx, originalId);
        if (
          !original ||
          original.kind !== "transfer" ||
          original.recipient_id !== actorId
        )
          throw new ForbiddenException(
            "Somente quem recebeu a transferência pode devolvê-la."
          );
        if (await this.movements.hasRefund(tx, originalId))
          throw new ConflictException("Transferência já devolvida.");
        const movement = await this.ledger.post(tx, {
          kind: "refund",
          senderId: actorId,
          recipientId: original.sender_id!,
          amount: Number(original.amount),
          originalId,
          reference: null,
        });
        await this.idempotency.remember(
          tx,
          scope,
          key,
          fingerprint,
          movement.id
        );
        await this.audit.record(
          "refund.completed",
          actorId,
          movement.id,
          ctx,
          { originalId, amount: Number(original.amount) },
          "success",
          null,
          tx
        );
        return movement;
      });
    } catch (error) {
      logUnexpected("refund.failed", ctx.correlationId, error, {
        actorId,
        originalId,
      });
      throw error;
    }
  }
}
