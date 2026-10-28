import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import { AuditService } from "../common/audit/audit.service";
import { Database } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { logUnexpected } from "../common/logging/failure-log";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import { digest } from "../common/security/crypto";
import {
  MAX_BANK_ACCOUNTS,
  PIX_PROOF_MAX_ATTEMPTS,
  PIX_PROOF_MINUTES,
} from "../common/constants";
import { BANKS, bankName } from "./banks.catalog";
import {
  BankAccountRow,
  BankingRepository,
  PixKeyRow,
} from "./banking.repository";
import {
  ConfirmPixKeyDto,
  CreateBankAccountDto,
  CreatePixKeyDto,
  UpdatePixKeyDto,
} from "./dto/banking.dto";
import { PIX_DIRECTORY, PixDirectoryProvider } from "./pix-directory.provider";
import {
  holderDocument,
  maxKeysPerAccount,
  needsOwnershipProof,
  normalizePixKey,
} from "./pix-key.rules";

/**
 * Dados bancários e chaves Pix do usuário.
 *
 * Fluxo de uma chave (espelha o registro no DICT do Banco Central):
 *   1. o formato é validado (CPF/CNPJ com dígitos verificadores e igual ao do
 *      titular; e-mail; celular +55; aleatória gerada pelo servidor);
 *   2. o diretório (porta `PixDirectoryProvider`) decide: aprova, recusa ou pede
 *      PROVA DE POSSE (código enviado ao e-mail/celular da chave);
 *   3. com a prova correta, a chave passa a "approved".
 *
 * Regras: chave única em todo o sistema (e, portanto, em cada banco); até 5
 * chaves por conta de pessoa física e 20 de pessoa jurídica; o usuário só enxerga
 * e altera o que é seu.
 */
@Injectable()
export class BankingService {
  constructor(
    private readonly db: Database,
    private readonly repo: BankingRepository,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(PIX_DIRECTORY) private readonly directory: PixDirectoryProvider
  ) {}

  banks() {
    return { items: BANKS };
  }

  /** Contas do usuário, cada uma com suas chaves e o limite de chaves da conta. */
  async list(userId: string) {
    const [accounts, keys] = await Promise.all([
      this.repo.listAccounts(userId),
      this.repo.listKeys(userId),
    ]);
    return {
      items: accounts.map(a => this.accountView(a, keys.filter(k => k.bank_account_id === a.id))),
    };
  }

  async addAccount(userId: string, dto: CreateBankAccountDto, ctx: AuditContext) {
    await this.limiter.throttle(`bank-write:${userId}`, 30);
    const holder = holderDocument(dto.holderDocument);
    const id = randomUUID();
    try {
      await this.db.transaction(async tx => {
        if ((await this.repo.countAccounts(tx, userId)) >= MAX_BANK_ACCOUNTS)
          throw new UnprocessableEntityException(
            `Limite de ${MAX_BANK_ACCOUNTS} contas bancárias atingido.`
          );
        await this.repo.insertAccount(tx, {
          id,
          userId,
          bankCode: dto.bankCode,
          agency: dto.agency,
          accountNumber: dto.accountNumber.toUpperCase(),
          accountType: dto.accountType,
          holderDocument: holder,
        });
        await this.audit.record("bank.account.added", userId, id, ctx, { bankCode: dto.bankCode }, "success", null, tx);
      });
    } catch (e: any) {
      // Violação de UNIQUE (banco + agência + conta): conta já cadastrada.
      if (e.code === "23505")
        throw new ConflictException("Esta conta bancária já está cadastrada.");
      throw this.unexpected("bank.account.add", ctx, e);
    }
    return { id, message: "Conta bancária cadastrada." };
  }

  async removeAccount(userId: string, id: string, ctx: AuditContext) {
    const removed = await this.db.transaction(async tx => {
      const ok = await this.repo.deleteAccount(tx, userId, id);
      if (ok) await this.audit.record("bank.account.removed", userId, id, ctx, {}, "success", null, tx);
      return ok;
    });
    if (!removed) throw new NotFoundException("Conta não encontrada.");
    return { message: "Conta bancária removida, com as chaves Pix dela." };
  }

  async addKey(userId: string, accountId: string, dto: CreatePixKeyDto, ctx: AuditContext) {
    await this.limiter.throttle(`pix-write:${userId}`, 20);
    const account = await this.repo.findAccount(userId, accountId);
    if (!account) throw new NotFoundException("Conta não encontrada.");
    if (dto.type !== "evp" && !dto.value)
      throw new UnprocessableEntityException("Informe a chave.");
    const value = normalizePixKey(dto.type, dto.value, account.holder_document);
    // Verificação antecipada só para responder rápido; a garantia real é o UNIQUE do banco.
    if (await this.repo.keyExists(value)) throw this.duplicate();

    // 1) O diretório decide ANTES de gravarmos (como no credenciamento real).
    let decision;
    try {
      decision = await this.directory.submit({
        type: dto.type,
        value,
        holderDocument: account.holder_document,
        bankCode: account.bank_code,
        agency: account.agency,
        accountNumber: account.account_number,
      });
    } catch (e) {
      logUnexpected("pix.directory.failed", ctx.correlationId, e);
      throw new ServiceUnavailableException(
        "Diretório do Pix indisponível. Tente novamente em instantes."
      );
    }

    const id = randomUUID();
    const code = needsOwnershipProof(dto.type) && decision.status === "awaiting_ownership" ? this.newCode() : null;
    try {
      await this.db.transaction(async tx => {
        // Trava a conta: duas inclusões simultâneas não passam do limite de chaves.
        const locked = await this.repo.lockAccount(tx, userId, accountId);
        if (!locked) throw new NotFoundException("Conta não encontrada.");
        if ((await this.repo.countKeys(tx, accountId)) >= maxKeysPerAccount(locked.holder_document))
          throw new UnprocessableEntityException(
            `Esta conta já tem o máximo de ${maxKeysPerAccount(locked.holder_document)} chaves Pix.`
          );
        await this.repo.insertKey(tx, {
          id,
          accountId,
          userId,
          type: dto.type,
          value,
          status: decision.status === "awaiting_ownership" ? "pending" : decision.status,
          protocol: decision.protocol,
          reason: decision.status === "rejected" ? decision.reason : null,
          proofHash: code ? digest(code) : null,
          proofMinutes: code ? PIX_PROOF_MINUTES : null,
        });
        await this.audit.record("pix.key.registered", userId, id, ctx, { type: dto.type, status: decision.status }, "success", null, tx);
      });
    } catch (e: any) {
      if (e.code === "23505") throw this.duplicate();
      if (e instanceof HttpException) throw e;
      throw this.unexpected("pix.key.add", ctx, e);
    }
    // O código só sai DEPOIS do commit: nunca se envia prova de uma chave que não ficou gravada.
    if (code) await this.deliver(dto.type, value, code, ctx);
    return {
      id,
      status: decision.status === "awaiting_ownership" ? "pending" : decision.status,
      message: this.registrationMessage(decision.status),
    };
  }

  /** Confere o código de posse e conclui o registro. */
  async confirmKey(userId: string, keyId: string, dto: ConfirmPixKeyDto, ctx: AuditContext) {
    await this.limiter.throttle(`pix-proof:${userId}`, 10);
    const outcome = await this.db.transaction(async tx => {
      const key = await this.repo.lockKey(tx, userId, keyId);
      if (!key) throw new NotFoundException("Chave não encontrada.");
      if (key.status !== "pending" || !key.proof_hash)
        throw new UnprocessableEntityException("Esta chave não aguarda confirmação.");
      if (key.proof_attempts >= PIX_PROOF_MAX_ATTEMPTS)
        return { ok: false as const, reason: "Tentativas esgotadas. Solicite um novo código." };
      if (!key.proof_expires_at || key.proof_expires_at.getTime() < Date.now())
        return { ok: false as const, reason: "Código expirado. Solicite um novo." };
      if (digest(dto.code) !== key.proof_hash) return { ok: false as const, reason: "Código incorreto.", attempt: key.id };
      const decision = await this.directory.confirm(key.protocol);
      if (decision.status !== "approved") return { ok: false as const, reason: "Chave recusada pelo diretório." };
      await this.repo.approveKey(tx, key.id);
      await this.audit.record("pix.key.approved", userId, key.id, ctx, { type: key.key_type }, "success", null, tx);
      return { ok: true as const };
    });
    if (!outcome.ok) {
      // A tentativa errada é gravada FORA da transação para não ser desfeita por ela.
      if ("attempt" in outcome && outcome.attempt) await this.repo.addProofAttempt(outcome.attempt);
      throw new UnprocessableEntityException(outcome.reason);
    }
    return { message: "Chave Pix aprovada." };
  }

  /** Gera e envia um novo código de posse (invalida o anterior). */
  async resendCode(userId: string, keyId: string, ctx: AuditContext) {
    await this.limiter.throttle(`pix-resend:${userId}`, 5);
    const code = this.newCode();
    const key = await this.db.transaction(async tx => {
      const row = await this.repo.lockKey(tx, userId, keyId);
      if (!row) throw new NotFoundException("Chave não encontrada.");
      if (row.status !== "pending" || !needsOwnershipProof(row.key_type))
        throw new UnprocessableEntityException("Esta chave não aguarda confirmação.");
      await this.repo.renewProof(tx, row.id, digest(code), PIX_PROOF_MINUTES);
      await this.audit.record("pix.key.code_resent", userId, row.id, ctx, {}, "success", null, tx);
      return row;
    });
    await this.deliver(key.key_type, key.key_value, code, ctx);
    return { message: "Enviamos um novo código." };
  }

  /**
   * Edita o valor de uma chave (CPF, CNPJ, e-mail ou celular). Passa pelas MESMAS
   * regras do cadastro e reinicia o registro: e-mail e celular voltam a exigir
   * o código de posse. A chave aleatória não se edita (o valor é gerado pelo
   * sistema): remova e crie outra. A chave continua na mesma conta.
   */
  async updateKey(userId: string, keyId: string, dto: UpdatePixKeyDto, ctx: AuditContext) {
    await this.limiter.throttle(`pix-write:${userId}`, 20);
    const current = await this.db.transaction(async tx => this.repo.lockKey(tx, userId, keyId));
    if (!current) throw new NotFoundException("Chave não encontrada.");
    if (current.key_type === "evp")
      throw new UnprocessableEntityException(
        "A chave aleatória não pode ser editada. Remova-a e crie outra."
      );
    const account = await this.repo.findAccount(userId, current.bank_account_id);
    if (!account) throw new NotFoundException("Conta não encontrada.");
    const value = normalizePixKey(current.key_type, dto.value, account.holder_document);
    if (value === current.key_value)
      throw new UnprocessableEntityException("Informe um valor diferente do atual.");
    if (await this.repo.keyExists(value)) throw this.duplicate();

    let decision;
    try {
      decision = await this.directory.submit({
        type: current.key_type,
        value,
        holderDocument: account.holder_document,
        bankCode: account.bank_code,
        agency: account.agency,
        accountNumber: account.account_number,
      });
    } catch (e) {
      logUnexpected("pix.directory.failed", ctx.correlationId, e);
      throw new ServiceUnavailableException("Diretório do Pix indisponível. Tente novamente em instantes.");
    }
    const code = decision.status === "awaiting_ownership" ? this.newCode() : null;
    const status = decision.status === "awaiting_ownership" ? "pending" : decision.status;
    try {
      await this.db.transaction(async tx => {
        // Relê com bloqueio: se a chave foi removida ou trocada no meio do caminho, recusa.
        const locked = await this.repo.lockKey(tx, userId, keyId);
        if (!locked || locked.key_value !== current.key_value)
          throw new ConflictException("A chave foi alterada. Atualize a página e tente de novo.");
        await this.repo.updateKey(tx, keyId, {
          value,
          status,
          protocol: decision.protocol,
          reason: decision.status === "rejected" ? decision.reason : null,
          proofHash: code ? digest(code) : null,
          proofMinutes: code ? PIX_PROOF_MINUTES : null,
        });
        await this.audit.record("pix.key.updated", userId, keyId, ctx, { type: current.key_type, status }, "success", null, tx);
      });
    } catch (e: any) {
      if (e.code === "23505") throw this.duplicate();
      if (e instanceof HttpException) throw e;
      throw this.unexpected("pix.key.update", ctx, e);
    }
    if (code) await this.deliver(current.key_type, value, code, ctx);
    return {
      id: keyId,
      status,
      message:
        status === "pending"
          ? "Chave alterada. Informe o código enviado ao novo contato para concluir."
          : "Chave alterada e aprovada.",
    };
  }

  async removeKey(userId: string, keyId: string, ctx: AuditContext) {
    const removed = await this.db.transaction(async tx => {
      const ok = await this.repo.deleteKey(tx, userId, keyId);
      if (ok) await this.audit.record("pix.key.removed", userId, keyId, ctx, {}, "success", null, tx);
      return ok;
    });
    if (!removed) throw new NotFoundException("Chave não encontrada.");
    return { message: "Chave Pix removida." };
  }

  // ---- internos -----------------------------------------------------------

  private accountView(a: BankAccountRow, keys: PixKeyRow[]) {
    return {
      id: a.id,
      bankCode: a.bank_code,
      bankName: bankName(a.bank_code) ?? a.bank_code,
      agency: a.agency,
      accountNumber: a.account_number,
      accountType: a.account_type,
      holderDocument: a.holder_document,
      maxKeys: maxKeysPerAccount(a.holder_document),
      keys: keys.map(k => ({
        id: k.id,
        type: k.key_type,
        value: k.key_value,
        status: k.status,
        protocol: k.protocol,
        reason: k.reason,
        createdAt: k.created_at,
        approvedAt: k.approved_at,
        proofExpiresAt: k.status === "pending" ? k.proof_expires_at : null,
      })),
    };
  }

  /** Código numérico de 6 dígitos de gerador criptográfico. */
  private newCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  /** Falha no envio não derruba o cadastro: o usuário pode pedir reenvio. */
  private async deliver(type: PixKeyRow["key_type"], value: string, code: string, ctx: AuditContext) {
    try {
      await this.directory.sendOwnershipCode(type, value, code);
    } catch (e) {
      logUnexpected("pix.code.delivery_failed", ctx.correlationId, e);
    }
  }

  private duplicate() {
    return new ConflictException("Esta chave Pix já está cadastrada.");
  }

  private registrationMessage(status: string) {
    if (status === "approved") return "Chave Pix registrada e aprovada.";
    if (status === "rejected") return "O diretório recusou a chave.";
    return "Enviamos um código de confirmação. Informe-o para concluir o registro.";
  }

  private unexpected(event: string, ctx: AuditContext, e: unknown) {
    if (e instanceof HttpException) return e;
    logUnexpected(event, ctx.correlationId, e);
    return e;
  }
}
