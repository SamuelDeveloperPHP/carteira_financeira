import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { Database } from "./db";
import { Audit } from "./audit";
import * as S from "./security";

export interface DepositProvider {
  readonly name: string;
  confirm(reference: string): Promise<void>;
}
export class SimulatedDepositProvider implements DepositProvider {
  readonly name = "simulation";
  async confirm(reference: string) {
    if (process.env.DEMO_DEPOSITS !== "true")
      throw new ForbiddenException("Depósitos simulados desabilitados.");
    S.text(reference, 8, 100);
  }
}

@Injectable()
export class Wallet {
  constructor(
    private readonly db: Database,
    private readonly audit: Audit
  ) {}
  private async repeat(
    c: PoolClient,
    scope: string,
    key: string,
    fingerprint: string
  ) {
    // Transaction-scoped lock makes concurrent retries wait before reading the result.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${scope}:${key}`,
    ]);
    const { rows } = await c.query(
      "SELECT i.fingerprint,m.* FROM idempotency i JOIN movements m ON m.id=i.movement_id WHERE scope=$1 AND key=$2",
      [scope, key]
    );
    if (rows.length && rows[0].fingerprint !== fingerprint)
      throw new ConflictException(
        "Esta identificação já foi usada com outros dados."
      );
    return rows[0];
  }
  private async move(
    c: PoolClient,
    kind: string,
    sender: string | null,
    recipient: string,
    amount: number,
    original: string | null,
    reference: string | null
  ) {
    const ids = [sender, recipient].filter(Boolean).sort();
    const { rows } = await c.query(
      "SELECT user_id,balance FROM wallets WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE",
      [ids]
    );
    if (rows.length !== ids.length)
      throw new NotFoundException("Carteira não encontrada.");
    const balances = new Map(rows.map(r => [r.user_id, Number(r.balance)]));
    if (sender && balances.get(sender)! < amount)
      throw new BadRequestException("Saldo insuficiente.");
    if (balances.get(recipient)! + amount > 1000000000000)
      throw new BadRequestException(
        "Limite da carteira destinatária excedido."
      );
    const id = randomUUID();
    const movement = (
      await c.query(
        "INSERT INTO movements(id,kind,sender_id,recipient_id,amount,original_id,reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [id, kind, sender, recipient, amount, original, reference]
      )
    ).rows[0];
    for (const uid of ids as string[]) {
      const delta = uid === sender ? -amount : amount;
      const balance = (
        await c.query(
          "UPDATE wallets SET balance=balance+$1 WHERE user_id=$2 RETURNING balance",
          [delta, uid]
        )
      ).rows[0].balance;
      await c.query(
        "INSERT INTO entries(movement_id,user_id,delta,balance_after) VALUES($1,$2,$3,$4)",
        [id, uid, delta, balance]
      );
    }
    return movement;
  }
  async transfer(body: unknown, keyValue: unknown, req: any) {
    if (req.auth.role !== "user")
      throw new ForbiddenException(
        "O master tem acesso somente para auditoria."
      );
    const b = S.object(body, ["recipientEmail", "amount"]);
    const recipientEmail = S.email(b.recipientEmail),
      amount = S.money(b.amount),
      key = S.idempotencyKey(keyValue);
    const sender = req.auth.user_id;
    const scope = `transfer:${sender}`,
      fingerprint = S.digest(JSON.stringify([recipientEmail, amount]));
    return this.db.transaction(async c => {
      const previous = await this.repeat(c, scope, key, fingerprint);
      if (previous) {
        await this.audit.record(
          "transfer.replayed",
          sender,
          previous.id,
          S.context(req),
          {},
          "success",
          null,
          c
        );
        return previous;
      }
      const recipient = (
        await c.query("SELECT id FROM users WHERE email=$1 AND role='user'", [
          recipientEmail,
        ])
      ).rows[0]?.id;
      if (!recipient)
        throw new NotFoundException("Destinatário não encontrado.");
      if (sender === recipient)
        throw new BadRequestException("Escolha outra pessoa para transferir.");
      const movement = await this.move(
        c,
        "transfer",
        sender,
        recipient,
        amount,
        null,
        null
      );
      await c.query("INSERT INTO idempotency VALUES($1,$2,$3,$4)", [
        scope,
        key,
        fingerprint,
        movement.id,
      ]);
      await this.audit.record(
        "transfer.completed",
        sender,
        movement.id,
        S.context(req),
        { recipientId: recipient, amount },
        "success",
        null,
        c
      );
      return movement;
    });
  }
  async refund(idValue: unknown, keyValue: unknown, req: any) {
    if (req.auth.role !== "user")
      throw new ForbiddenException(
        "O master tem acesso somente para auditoria."
      );
    const id = S.uuid(idValue),
      key = S.idempotencyKey(keyValue),
      actor = req.auth.user_id,
      scope = `refund:${actor}`,
      fingerprint = S.digest(id);
    req.targetResource = id;
    return this.db.transaction(async c => {
      const previous = await this.repeat(c, scope, key, fingerprint);
      if (previous) {
        await this.audit.record(
          "refund.replayed",
          actor,
          previous.id,
          S.context(req),
          {},
          "success",
          null,
          c
        );
        return previous;
      }
      // Immutable movements need no UPDATE privilege: serialize refunds by original ID.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `refund-original:${id}`,
      ]);
      const original = (
        await c.query("SELECT * FROM movements WHERE id=$1", [id])
      ).rows[0];
      if (
        !original ||
        original.kind !== "transfer" ||
        original.recipient_id !== actor
      )
        throw new ForbiddenException(
          "Somente quem recebeu a transferência pode devolvê-la."
        );
      if (
        (await c.query("SELECT id FROM movements WHERE original_id=$1", [id]))
          .rowCount
      )
        throw new ConflictException("Transferência já devolvida.");
      const movement = await this.move(
        c,
        "refund",
        actor,
        original.sender_id,
        Number(original.amount),
        id,
        null
      );
      await c.query("INSERT INTO idempotency VALUES($1,$2,$3,$4)", [
        scope,
        key,
        fingerprint,
        movement.id,
      ]);
      await this.audit.record(
        "refund.completed",
        actor,
        movement.id,
        S.context(req),
        { originalId: id, amount: Number(original.amount) },
        "success",
        null,
        c
      );
      return movement;
    });
  }
  async deposit(
    emailValue: unknown,
    amountValue: unknown,
    referenceValue: unknown,
    ctx: any,
    provider: DepositProvider = new SimulatedDepositProvider()
  ) {
    const email = S.email(emailValue),
      amount = S.money(amountValue),
      key = S.idempotencyKey(referenceValue);
    await provider.confirm(key);
    const scope = `deposit:${provider.name}`,
      fingerprint = S.digest(JSON.stringify([email, amount]));
    return this.db.transaction(async c => {
      const previous = await this.repeat(c, scope, key, fingerprint);
      if (previous) {
        await this.audit.record(
          "deposit.replayed",
          null,
          previous.id,
          ctx,
          { provider: provider.name },
          "success",
          null,
          c
        );
        return previous;
      }
      const user = (
        await c.query("SELECT id FROM users WHERE email=$1 AND role='user'", [
          email,
        ])
      ).rows[0];
      if (!user)
        throw new NotFoundException("Carteira destinatária não encontrada.");
      const movement = await this.move(
        c,
        "deposit",
        null,
        user.id,
        amount,
        null,
        key
      );
      await c.query("INSERT INTO idempotency VALUES($1,$2,$3,$4)", [
        scope,
        key,
        fingerprint,
        movement.id,
      ]);
      await this.audit.record(
        "deposit.completed",
        null,
        movement.id,
        ctx,
        { recipientId: user.id, provider: provider.name, amount },
        "success",
        null,
        c
      );
      return movement;
    });
  }
  async statement(userId: string, pageValue: unknown) {
    const page = S.page(pageValue);
    const result = await this.db.pool.query(
      `SELECT m.*,e.delta,e.balance_after,s.name AS sender_name,s.email AS sender_email,r.name AS recipient_name,r.email AS recipient_email,rev.id AS refund_id
      FROM entries e JOIN movements m ON m.id=e.movement_id LEFT JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id LEFT JOIN movements rev ON rev.original_id=m.id
      WHERE e.user_id=$1 ORDER BY e.id DESC LIMIT 21 OFFSET $2`,
      [userId, (page - 1) * 20]
    );
    return {
      items: result.rows.slice(0, 20),
      page,
      hasMore: result.rows.length > 20,
    };
  }
  async balance(req: any) {
    if (req.auth.role !== "user")
      throw new ForbiddenException("Acesse a auditoria administrativa.");
    const row = (
      await this.db.pool.query("SELECT balance FROM wallets WHERE user_id=$1", [
        req.auth.user_id,
      ])
    ).rows[0];
    return { balance: Number(row.balance), currency: "BRL", simulated: true };
  }
}
