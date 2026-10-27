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

/** Tudo que o razão precisa para registrar um movimento. Valores em centavos. */
export interface Posting {
  kind: MovementKind;
  /** null em depósito (o dinheiro vem de fora). */
  senderId: string | null;
  recipientId: string;
  amount: number;
  originalId: string | null;
  reference: string | null;
}

/**
 * Núcleo contábil de PARTIDA DOBRADA, compartilhado por depósito, transferência
 * e devolução. Toda movimentação passa por aqui, então as regras de saldo
 * existem em um único lugar.
 *
 * Partida dobrada: cada movimento gera um lançamento por carteira afetada
 * (negativo em quem paga, positivo em quem recebe). Como transferência só move
 * dinheiro de uma carteira para outra, o total do sistema não muda; isso permite
 * conciliar saldos com lançamentos a qualquer momento.
 *
 * IMPORTANTE: precisa rodar dentro da transação de quem chama. Se algo falhar
 * aqui, a operação inteira é desfeita junto.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly ledger: LedgerRepository) {}

  /**
   * Registra um movimento: bloqueia carteiras, valida saldo e limite, grava o
   * movimento e os lançamentos e atualiza os saldos.
   *
   * @returns o movimento gravado.
   * @throws NotFoundException se alguma carteira não existir.
   * @throws BadRequestException por saldo insuficiente ou limite do destinatário.
   */
  async post(tx: Queryable, p: Posting): Promise<Movement> {
    // 1) Bloqueio em ORDEM FIXA (ids ordenados). Se A->B e B->A acontecerem ao
    //    mesmo tempo, ambas bloqueiam na mesma ordem e uma espera a outra;
    //    ordens diferentes causariam DEADLOCK (cada uma esperando a outra).
    const ids = ([p.senderId, p.recipientId].filter(Boolean) as string[]).sort();
    const balances = await this.ledger.lockWallets(tx, ids);
    if (balances.size !== ids.length)
      throw new NotFoundException("Carteira não encontrada.");

    // 2) Validações DEPOIS do bloqueio. O saldo lido aqui já é o definitivo:
    //    outra transação que queira gastar o mesmo dinheiro espera a nossa
    //    terminar e então enxerga o saldo já reduzido. É isto que impede o gasto
    //    duplo (testado com 25 saídas simultâneas sobre o mesmo saldo).
    if (p.senderId && balances.get(p.senderId)! < p.amount)
      throw new BadRequestException("Saldo insuficiente.");
    if (balances.get(p.recipientId)! + p.amount > MAX_CENTS)
      throw new BadRequestException(
        "Limite da carteira destinatária excedido."
      );

    // 3) Grava o movimento (a "ordem": quem, para quem, quanto, de que tipo).
    const movement = await this.ledger.insertMovement(tx, {
      id: randomUUID(),
      ...p,
    });

    // 4) Para cada carteira: aplica o delta (negativo no remetente, positivo no
    //    destinatário) e grava o lançamento com o saldo resultante, que alimenta
    //    o extrato e a conciliação. O banco ainda tem o CHECK saldo >= 0 como
    //    última linha de defesa.
    for (const userId of ids) {
      const delta = userId === p.senderId ? -p.amount : p.amount;
      const balanceAfter = await this.ledger.applyDelta(tx, userId, delta);
      await this.ledger.insertEntry(tx, movement.id, userId, delta, balanceAfter);
    }
    return movement;
  }
}
