// Tipos que espelham as respostas da API (compartilhados pelas páginas).

export type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "master";
};
// Uma linha do extrato. Valores monetários chegam como TEXTO em centavos
// (bigint do banco); `delta` é o efeito na carteira de quem consulta
// (negativo = saiu, positivo = entrou). `refund_id` preenchido = já devolvida.
export type Movement = {
  id: string;
  kind: string;
  amount: string;
  delta: string;
  balance_after: string;
  sender_id: string | null;
  recipient_id: string;
  sender_name: string;
  recipient_name: string;
  sender_email: string;
  recipient_email: string;
  original_id: string | null;
  refund_id: string | null;
  created_at: string;
};
// Localização declarada pelo navegador. NÃO é verificada: serve de pista na
// auditoria, nunca de prova de onde a pessoa está.
export type LocationData = {
  status: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
};
// Evento da trilha de auditoria (tela do master): quem, o quê, de onde, resultado.
export type AuditEvent = {
  id: string;
  actor_name: string;
  actor_email: string;
  action: string;
  outcome: string;
  resource: string;
  reason: string;
  correlation_id: string;
  ip: string;
  device: string;
  location: LocationData;
  details: Record<string, unknown>;
  created_at: string;
};
export type Account = User & {
  balance: string | null;
  totp_enabled: boolean;
  created_at: string;
};
// Aviso de dinheiro recebido. A mensagem já vem pronta, em português, do servidor.
// Só os NÃO lidos são listados: ao marcar como lido, o aviso some da lista.
export type AppNotification = {
  id: string;
  kind: "transfer_received" | "refund_received";
  message: string;
  amount: string;
  movementId: string;
  createdAt: string;
};
// Formato padrão de toda listagem paginada da API.
export type List<T> = { items: T[]; page: number; hasMore: boolean };
// Indicadores do painel de monitoramento do master, incluindo a conciliação
// (soma dos saldos x soma dos depósitos) e os alertas.
export type Metrics = {
  users: number;
  movements: number;
  balance: string;
  database: string;
  uptimeSeconds: number;
  failuresLast15Minutes: number;
  reconciliation: { balanced: boolean; mismatchedWallets: number };
  alerts: { level: string; message: string }[];
};
