/** deposit: entrada de fora · transfer: entre usuários · refund: devolução de uma transferência. */
export type MovementKind = "deposit" | "transfer" | "refund";

/**
 * Linha de `movements` como o banco devolve. Atenção: colunas bigint chegam do
 * driver `pg` como TEXTO (para não perder precisão), por isso `amount` é string.
 */
export interface Movement {
  id: string;
  kind: MovementKind;
  sender_id: string | null; // null em depósito
  recipient_id: string;
  amount: string; // centavos
  original_id: string | null; // preenchido só em devolução
  reference: string | null; // referência do provedor, em depósito
  created_at: Date;
}

/** Dados para criar um movimento; aqui `amount` é número (centavos) já validado. */
export interface NewMovement {
  id: string;
  kind: MovementKind;
  senderId: string | null;
  recipientId: string;
  amount: number;
  originalId: string | null;
  reference: string | null;
}
