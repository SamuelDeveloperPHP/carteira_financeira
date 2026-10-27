import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MAX_CENTS } from "../common/constants";
import { Queryable } from "../common/database/database.service";
import { LedgerRepository } from "./ledger.repository";
import { Movement, MovementKind } from "./wallet.types";

export interface Posting {
  kind: MovementKind;
  senderId: string | null;
  recipientId: string;
  amount: number;
  originalId: string | null;
  reference: string | null;
}

// Double-entry core shared by deposits, transfers and refunds. It must run inside
// the caller's transaction: any failure here rolls the whole operation back.
@Injectable()
export class LedgerService {
  constructor(private readonly ledger: LedgerRepository) {}

  async post(tx: Queryable, p: Posting): Promise<Movement> {
    const ids = ([p.senderId, p.recipientId].filter(Boolean) as string[]).sort();
    const balances = await this.ledger.lockWallets(tx, ids);
    if (balances.size !== ids.length)
      throw new NotFoundException("Carteira não encontrada.");
    // The balance is read after the row lock, so concurrent spends see each other.
    if (p.senderId && balances.get(p.senderId)! < p.amount)
      throw new BadRequestException("Saldo insuficiente.");
    if (balances.get(p.recipientId)! + p.amount > MAX_CENTS)
      throw new BadRequestException(
        "Limite da carteira destinatária excedido."
      );
    const movement = await this.ledger.insertMovement(tx, {
      id: randomUUID(),
      ...p,
    });
    for (const userId of ids) {
      const delta = userId === p.senderId ? -p.amount : p.amount;
      const balanceAfter = await this.ledger.applyDelta(tx, userId, delta);
      await this.ledger.insertEntry(tx, movement.id, userId, delta, balanceAfter);
    }
    return movement;
  }
}
