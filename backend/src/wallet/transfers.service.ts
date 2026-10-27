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
 * Casos de uso que movem dinheiro entre dois usuários: TRANSFERIR e DEVOLVER.
 *
 * É aqui que o requisito "a transferência deve ser uma transação passível de
 * reversão em qualquer caso de inconsistência ou por solicitação do usuário" é
 * atendido, em dois níveis:
 *
 *  1. Reversão por INCONSISTÊNCIA (automática): cada caso de uso roda dentro de
 *     UMA transação do banco. Se qualquer passo falhar (saldo, destinatário,
 *     erro de SQL, queda de conexão), o banco desfaz TUDO: saldos, movimento,
 *     lançamentos e chave de idempotência. Nunca fica "debitou mas não creditou".
 *
 *  2. Reversão por SOLICITAÇÃO DO USUÁRIO (`refund`): quem recebeu pode devolver
 *     a transferência, integralmente e uma única vez. A devolução é um NOVO
 *     movimento ligado ao original; nada é apagado nem editado, então a
 *     história continua auditável.
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
   * Envia dinheiro de `senderId` para o usuário dono de `dto.recipientEmail`.
   *
   * @param senderId vem SEMPRE da sessão autenticada, nunca do corpo da requisição.
   * @param key chave de idempotência (cabeçalho). Repetir a mesma chave com os
   *   mesmos dados devolve o movimento original em vez de pagar de novo; com
   *   dados diferentes, a operação é recusada (409).
   * @returns o movimento criado (ou o original, em caso de repetição).
   */
  async transfer(
    senderId: string,
    dto: TransferDto,
    key: string,
    ctx: AuditContext
  ): Promise<Movement> {
    // "Escopo" separa as chaves de cada usuário e de cada operação: a chave "abc"
    // de uma pessoa não colide com a "abc" de outra. A "impressão digital" resume
    // os dados do pedido, para detectar reutilização da chave com valores diferentes.
    const scope = `transfer:${senderId}`,
      fingerprint = digest(JSON.stringify([dto.recipientEmail, dto.amount]));
    try {
      return await this.db.transaction(async tx => {
        // PASSO 1 - Repetição segura. Trava a chave (requisições simultâneas com
        // a mesma chave entram em fila) e verifica se ela já foi usada.
        const previous = await this.idempotency.replay(
          tx,
          scope,
          key,
          fingerprint
        );
        if (previous) {
          // Já foi feito: não move dinheiro de novo, só registra a repetição e
          // devolve o resultado original.
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

        // PASSO 2 - Regras do pedido. Só contas de cliente recebem dinheiro (o
        // master é auditor e não tem carteira operável).
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

        // PASSO 3 - Movimentação propriamente dita. O razão bloqueia as duas
        // carteiras, confere o saldo (REQUISITO: validar saldo antes de
        // transferir), grava o movimento e os lançamentos e atualiza os saldos.
        const movement = await this.ledger.post(tx, {
          kind: "transfer",
          senderId,
          recipientId,
          amount: dto.amount,
          originalId: null,
          reference: null,
        });

        // PASSO 4 - Guarda o resultado para futuras repetições e registra a
        // auditoria. Ambos na MESMA transação: se algo falhar daqui em diante,
        // o dinheiro também volta (rollback).
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
      // Chegar ao fim do callback = COMMIT. Tudo acima passa a existir de uma vez.
    } catch (error) {
      // A transação já foi desfeita por Database.transaction. Recusas de negócio
      // (saldo insuficiente, destinatário inexistente) seguem para o filtro HTTP,
      // que as audita. Qualquer outra coisa é uma falha inesperada: vai para o
      // log estruturado com o ID de correlação.
      logUnexpected("transfer.failed", ctx.correlationId, error, { senderId });
      throw error;
    }
  }

  /**
   * Devolve uma transferência (reversão por pedido do usuário).
   *
   * Regras: só quem RECEBEU pode devolver; a devolução é integral; só pode
   * ocorrer uma vez por transferência; e quem devolve precisa ainda ter o
   * dinheiro (o razão confere o saldo, como em qualquer movimento).
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
        // PASSO 1 - Repetição segura (mesma ideia da transferência).
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

        // PASSO 2 - Serializa devoluções da MESMA transferência. Movimentos são
        // imutáveis (a aplicação não tem UPDATE), então não dá para "marcar como
        // devolvida" travando a linha. Em vez disso, trava-se uma chave derivada
        // do id original: duas devoluções simultâneas entram em fila. Uma
        // restrição UNIQUE no banco (original_id) é a segunda barreira.
        await this.idempotency.lockOriginal(tx, originalId);

        // PASSO 3 - Só quem recebeu a transferência pode devolvê-la. Uma única
        // mensagem cobre "não existe", "não é transferência" e "não é o
        // destinatário", para não revelar a existência de movimentos alheios.
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

        // PASSO 4 - A devolução é um movimento NOVO, no sentido inverso, com o
        // MESMO valor (integral) e apontando para o original.
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
