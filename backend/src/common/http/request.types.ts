import { UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

export type Role = "user" | "master";
/** setup: enrolling 2FA · challenge: awaiting the code · full: authenticated. */
export type SessionStage = "setup" | "challenge" | "full";

/** Request metadata stored with every audit event. */
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

/** The authenticated session attached by the guard; 401 if there is none. */
export function sessionOf(req: AppRequest): SessionUser {
  if (!req.auth) throw new UnauthorizedException("Entre para continuar.");
  return req.auth;
}
