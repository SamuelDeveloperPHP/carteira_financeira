/** transfer_received: alguém te enviou dinheiro · refund_received: alguém devolveu uma transferência sua. */
export type NotificationKind = "transfer_received" | "refund_received";

/**
 * Linha como o repositório devolve (já ligada ao movimento e a quem o enviou).
 * `amount` chega como texto porque bigint vem do `pg` como string.
 */
export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  movement_id: string;
  amount: string;
  counterpart_name: string | null;
  created_at: Date;
}

/** Formato público: a mensagem já vem pronta, em português. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  message: string;
  amount: string;
  movementId: string;
  createdAt: Date;
}
