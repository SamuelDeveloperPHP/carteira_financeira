import { randomUUID } from "node:crypto";
import { AppRequest, AuditContext } from "./request.types";

/**
 * Extrai da requisição os dados que acompanham todo evento de auditoria:
 * correlação, IP, navegador e localização. Os textos são cortados para caber nas
 * colunas, então um cabeçalho gigante não consegue estourar o banco.
 *
 * A localização vem do navegador e NÃO é verificada: serve para investigação,
 * nunca como prova de onde a pessoa está. Se o login atual não informou, usa a
 * da sessão; se não houver, registra "unavailable".
 */
export function auditContext(req: AppRequest): AuditContext {
  return {
    correlationId: req.correlationId || randomUUID(),
    // req.ip é confiável porque o Express só aceita 1 proxy (ver main.ts).
    ip: (req.ip || "unknown").slice(0, 80),
    device: String(req.headers?.["user-agent"] || "unknown").slice(0, 500),
    location: req.accessLocation ||
      req.auth?.context?.location || { status: "unavailable" },
  };
}
