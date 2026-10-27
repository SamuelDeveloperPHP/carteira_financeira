import { UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type Role = "user" | "master";
/**
 * Estágio da sessão:
 *   setup     - senha aceita; cadastrando o autenticador pela primeira vez
 *   challenge - senha aceita; falta digitar o código do autenticador
 *   full      - autenticado de verdade (única etapa que acessa rotas com dinheiro)
 */
export type SessionStage = "setup" | "challenge" | "full";

/** Metadados da requisição gravados em todo evento de auditoria: correlação, IP, navegador e localização. */
export interface AuditContext {
  correlationId: string;
  ip: string;
  device: string;
  location: unknown;
}

export interface SessionUser {
  token_hash: string;
  user_id: string;
  stage: SessionStage;
  context: Partial<AuditContext>;
  name: string;
  email: string;
  role: Role;
  totp_enabled: boolean;
}

export interface AppRequest extends Request {
  correlationId: string;
  auth?: SessionUser;
  // Set while a password has been accepted but no session exists yet.
  actorId?: string;
  accessLocation?: unknown;
  targetResource?: string | null;
}

/**
 * Devolve a sessão que o guard anexou à requisição; 401 se não houver. Os
 * serviços usam ISTO para saber quem é o usuário, nunca um id vindo do corpo da
 * requisição, que o cliente poderia forjar.
 */
export function sessionOf(req: AppRequest): SessionUser {
  if (!req.auth) throw new UnauthorizedException("Entre para continuar.");
  return req.auth;
}
