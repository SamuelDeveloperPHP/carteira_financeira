import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PAGE_SIZE } from "../common/constants";
import { Queryable } from "../common/database/database.service";
import { NotificationsRepository } from "./notifications.repository";
import {
  NotificationKind,
  NotificationRow,
  NotificationView,
} from "./notifications.types";

/** Centavos (texto do banco) -> "R$ 25,50", com espaço comum no lugar do espaço não separável. */
const brl = (cents: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(cents) / 100)
    .replace(/00a0/g, " ");

/**
 * Texto de cada tipo de aviso. Fica no servidor, em um lugar só: qualquer
 * cliente da API recebe a mesma mensagem, já pronta.
 */
const MESSAGES: Record<
  NotificationKind,
  (name: string, amount: string) => string
> = {
  transfer_received: (name, amount) => `${name} enviou ${amount} para você.`,
  refund_received: (name, amount) =>
    `${name} devolveu ${amount} da transferência que você enviou.`,
};

const toView = (row: NotificationRow): NotificationView => ({
  id: row.id,
  kind: row.kind,
  message: MESSAGES[row.kind](row.counterpart_name ?? "Alguém", brl(row.amount)),
  amount: row.amount,
  movementId: row.movement_id,
  createdAt: row.created_at,
});

/**
 * Avisos ao usuário sobre dinheiro recebido: transferência recebida e devolução
 * recebida.
 *
 * Duas responsabilidades:
 *   - CRIAR (`create`): chamado pelos serviços de transferência dentro da mesma
 *     transação do movimento, então aviso e dinheiro nunca divergem;
 *   - LER e MARCAR COMO LIDA: o usuário só vê, e só altera, os PRÓPRIOS avisos.
 *
 * Marcar como lida tira o aviso da listagem (mostra só as pendentes), mas a linha
 * permanece no banco com a data da leitura.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  /**
   * Cria o aviso na transação do chamador. Se a transferência der rollback, o
   * aviso some junto: ninguém é avisado de dinheiro que não chegou.
   */
  create(
    tx: Queryable,
    kind: NotificationKind,
    userId: string,
    movementId: string
  ) {
    return this.repo.insert(tx, { id: randomUUID(), userId, kind, movementId });
  }

  /** Página de avisos não lidos, mais novos primeiro, com o total de pendentes. */
  async list(userId: string, page = 1) {
    const rows = await this.repo.listUnread(
      userId,
      (page - 1) * PAGE_SIZE,
      PAGE_SIZE
    );
    return {
      items: rows.slice(0, PAGE_SIZE).map(toView),
      page,
      hasMore: rows.length > PAGE_SIZE,
      unread: await this.repo.countUnread(userId),
    };
  }

  /** Só o contador: chamada barata, usada pelo sino da barra a cada poucos segundos. */
  async unread(userId: string) {
    return { unread: await this.repo.countUnread(userId) };
  }

  /**
   * Marca um aviso como lido. Se o id não existe OU pertence a outra pessoa, a
   * resposta é a mesma (404): não se revela a existência de avisos alheios.
   */
  async markRead(userId: string, id: string) {
    if (!(await this.repo.markRead(userId, id)))
      throw new NotFoundException("Notificação não encontrada.");
    return { message: "Notificação marcada como lida." };
  }

  /** Marca todas as pendentes como lidas. */
  async markAllRead(userId: string) {
    const updated = await this.repo.markAllRead(userId);
    return {
      updated,
      message: updated
        ? "Todas as notificações foram marcadas como lidas."
        : "Você não tem notificações novas.",
    };
  }
}
