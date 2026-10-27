export type MovementKind = "deposit" | "transfer" | "refund";

// Row as stored; bigint columns arrive from pg as strings.
export interface Movement {
  id: string;
  kind: MovementKind;
  sender_id: string | null;
  recipient_id: string;
  amount: string;
  original_id: string | null;
  reference: string | null;
  created_at: Date;
}

export interface NewMovement {
  id: string;
  kind: MovementKind;
  senderId: string | null;
  recipientId: string;
  amount: number;
  originalId: string | null;
  reference: string | null;
}
