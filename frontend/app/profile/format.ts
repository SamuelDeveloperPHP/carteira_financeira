// Formatação usada na página de perfil.

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Data e hora no padrão pedido: dd/mm/yyyy h:mm:ss (hora de 0 a 23, sem zero à
 * esquerda; minutos e segundos com dois dígitos). Usa o fuso do navegador.
 */
export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${d.getHours()}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Duração em segundos -> "2h 05min 09s" (omite as unidades zeradas à esquerda). */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${two(m)}min ${two(r)}s`;
  if (m) return `${m}min ${two(r)}s`;
  return `${r}s`;
}

/** Escapa texto que vira HTML (tooltip do Leaflet): o aparelho/IP vêm do cliente e não são confiáveis. */
export const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );

// Tipos da API usados pelas abas.
export type AccessLocation = {
  status: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
};
export type AccessEntry = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: "logout" | "expired" | "revoked" | null;
  active: boolean;
  current: boolean;
  durationSeconds: number;
  ip: string | null;
  device: string | null;
  location: AccessLocation;
};
export const END_REASONS: Record<string, string> = {
  logout: "Saída (logout)",
  expired: "Sessão expirada",
  revoked: "Sessão encerrada pelo sistema",
};
export const LOCATION_STATES: Record<string, string> = {
  granted: "Localização registrada",
  denied: "Permissão negada",
  unavailable: "Indisponível",
  timeout: "Tempo esgotado",
  disabled: "Desativada pelo usuário",
};
