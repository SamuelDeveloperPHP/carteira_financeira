import { Injectable } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { PAGE_SIZE } from "../common/constants";
import { AuditContext } from "../common/http/request.types";
import { LedgerRepository } from "./ledger.repository";

/** Read side of the wallet: balance and paginated statement. */
@Injectable()
export class WalletService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditService
  ) {}

  /** Current balance in cents; a wallet without movements reads as zero. */
  async balance(userId: string) {
    const balance = await this.ledger.balanceOf(userId);
    return { balance: balance ?? 0, currency: "BRL", simulated: true };
  }

  /**
   * One page of movements, newest first. The repository fetches PAGE_SIZE + 1
   * rows so `hasMore` is known without a separate COUNT query.
   */
  async statement(userId: string, page = 1) {
    const rows = await this.ledger.statement(
      userId,
      (page - 1) * PAGE_SIZE,
      PAGE_SIZE
    );
    return {
      items: rows.slice(0, PAGE_SIZE),
      page,
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  /** A user reading their own statement is recorded; admin reads are audited separately. */
  async ownStatement(userId: string, page: number | undefined, ctx: AuditContext) {
    await this.audit.record("wallet.statement.view", userId, userId, ctx, {
      page: page ?? 1,
    });
    return this.statement(userId, page);
  }
}
