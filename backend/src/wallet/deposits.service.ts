import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import {
  SELF_DEPOSIT_PER_HOUR,
  SELF_DEPOSIT_WINDOW_SECONDS,
} from "../common/constants";
import { Database, Queryable } from "../common/database/database.service";
import { AuditContext } from "../common/http/request.types";
import { logUnexpected } from "../common/logging/failure-log";
import { RateLimiter } from "../common/rate-limit/rate-limiter.service";
import { digest } from "../common/security/crypto";
import { email, idempotencyKey, money } from "../common/security/validation";
import { UsersRepository } from "../users/users.repository";
import { DEPOSIT_PROVIDER, DepositProvider } from "./deposit.provider";
import { DepositDto } from "./dto/wallet.dto";
import { IdempotencyService } from "./idempotency.service";
import { LedgerService } from "./ledger.service";
import { Movement } from "./wallet.types";

/**
 * Tudo que descreve UM crédito já validado, independentemente de quem o pediu
 * (operador pela linha de comando ou o próprio usuário pela tela).
 */
interface Credit {
  /** Resolve o dono da carteira DENTRO da transação (e-mail do operador ou id da sessão). */
  recipient: (tx: Queryable) => Promise<string | undefined>;
  amount: number;
  /** Chave de idempotência, única dentro de `scope`. */
  reference: string;
  /** Separa as chaves de cada origem (operador x cada usuário), sem colisão. */
  scope: string;
  /** Resume os dados do pedido para detectar a mesma chave com valores diferentes. */
  fingerprint: string;
  /** Quem pediu (null = operador local). Vai para a auditoria. */
  actorId: string | null;
  /** Origem do pedido, gravada nos detalhes da auditoria. */
  origin: "operator" | "self-service";
  provider: DepositProvider;
  ctx: AuditContext;
}

/**
 * Credita uma carteira DEPOIS que um provedor confirma o pagamento.
 *
 * O depósito é a única forma de o dinheiro ENTRAR no sistema; transferências e
 * devoluções apenas o movem. Por isso a soma dos depósitos é a referência da
 * conciliação.
 *
 * Há duas portas de entrada, ambas passando pelo MESMO caminho (confirmação do
 * provedor, razão, idempotência e auditoria):
 *   - `deposit`     : comando local do operador (qualquer carteira, sem teto);
 *   - `selfDeposit` : o próprio usuário adiciona saldo à SUA carteira, com teto
 *                     por operação e limite de frequência.
 *
 * Nesta demonstração o provedor é simulado e só funciona com DEMO_DEPOSITS=true.
 * Com um provedor real, o usuário não confirma o próprio pagamento: o banco o
 * faz (webhook assinado), e o teto deixa de fazer sentido.
 */
@Injectable()
export class DepositsService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersRepository,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(DEPOSIT_PROVIDER) private readonly provider: DepositProvider
  ) {}

  /**
   * Depósito do OPERADOR (comando local).
   *
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
    return this.credit({
      recipient: tx => this.users.findCustomerIdByEmail(recipientEmail, tx),
      amount,
      reference,
      scope: `deposit:${provider.name}`,
      fingerprint: digest(JSON.stringify([recipientEmail, amount])),
      actorId: null,
      origin: "operator",
      provider,
      ctx,
    });
  }

  /**
   * Depósito do PRÓPRIO USUÁRIO ("adicionar saldo"). Só existe na carteira de
   * quem está logado: o id vem da sessão, nunca do corpo da requisição, então
   * ninguém credita a conta de outra pessoa.
   *
   * Proteções além das do depósito comum:
   *   - teto por operação (validado no DTO, ver SELF_DEPOSIT_MAX_CENTS);
   *   - no máximo SELF_DEPOSIT_PER_HOUR adições por hora por usuário;
   *   - escopo de idempotência próprio de cada usuário (a chave de uma pessoa
   *     nunca colide com a de outra).
   */
  async selfDeposit(
    userId: string,
    dto: DepositDto,
    key: string,
    ctx: AuditContext
  ): Promise<Movement> {
    await this.limiter.throttle(
      `deposit:${userId}`,
      SELF_DEPOSIT_PER_HOUR,
      SELF_DEPOSIT_WINDOW_SECONDS
    );
    return this.credit({
      recipient: async () => userId,
      amount: dto.amount,
      reference: key,
      scope: `deposit-self:${userId}`,
      fingerprint: digest(JSON.stringify([userId, dto.amount])),
      actorId: userId,
      origin: "self-service",
      provider: this.provider,
      ctx,
    });
  }

  /** Caminho único de crédito: confirma com o provedor e então registra no razão. */
  private async credit(c: Credit): Promise<Movement> {
    // A confirmação externa acontece ANTES de abrir a transação: não se deve
    // segurar uma transação (e bloqueios) esperando uma chamada de rede lenta.
    try {
      await c.provider.confirm(c.reference);
    } catch (error) {
      // Uma recusa deliberada (ex.: provedor desabilitado, 403) mantém seu status.
      if (error instanceof HttpException) throw error;
      // Falha inesperada (provedor fora do ar): vira 503 e NADA é creditado,
      // pois sem confirmação não há dinheiro.
      logUnexpected("deposit.provider.failed", c.ctx.correlationId, error, {
        provider: c.provider.name,
      });
      throw new ServiceUnavailableException(
        "Não foi possível confirmar o pagamento com o provedor."
      );
    }
    return this.db.transaction(async tx => {
      // Repetição segura: mesma chave e mesmos dados devolvem o movimento original.
      const previous = await this.idempotency.replay(
        tx,
        c.scope,
        c.reference,
        c.fingerprint
      );
      if (previous) {
        await this.audit.record(
          "deposit.replayed",
          c.actorId,
          previous.id,
          c.ctx,
          { provider: c.provider.name, origin: c.origin },
          "success",
          null,
          tx
        );
        return previous;
      }
      const recipientId = await c.recipient(tx);
      if (!recipientId)
        throw new NotFoundException("Carteira destinatária não encontrada.");
      // Depósito é um movimento SEM remetente: o dinheiro vem de fora.
      const movement = await this.ledger.post(tx, {
        kind: "deposit",
        senderId: null,
        recipientId,
        amount: c.amount,
        originalId: null,
        reference: c.reference,
      });
      await this.idempotency.remember(
        tx,
        c.scope,
        c.reference,
        c.fingerprint,
        movement.id
      );
      await this.audit.record(
        "deposit.completed",
        c.actorId,
        movement.id,
        c.ctx,
        {
          recipientId,
          provider: c.provider.name,
          amount: c.amount,
          origin: c.origin,
        },
        "success",
        null,
        tx
      );
      return movement;
    });
  }
}
