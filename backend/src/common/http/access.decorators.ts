import { SetMetadata } from "@nestjs/common";
import { Role } from "./request.types";

/**
 * Nível de acesso de uma rota. Quando NÃO há decorador, vale o mais restrito
 * ("seguro por padrão"): sessão completa, com 2FA.
 *
 *   public     : sem sessão (cadastro, login, saúde, recuperação de senha)
 *   any-stage  : qualquer sessão válida, mesmo antes do 2FA (status, logout)
 *   partial    : sessão ainda no fluxo do 2FA (configurar e verificar)
 *   (padrão)   : sessão completa com 2FA ativo
 */
export type AccessLevel = "public" | "any-stage" | "partial";

export const ACCESS_KEY = "access";
export const ROLES_KEY = "roles";

/** Marca a rota (ou o controller inteiro) com um nível de acesso. Lido pelo AccessGuard. */
export const Access = (level: AccessLevel) => SetMetadata(ACCESS_KEY, level);
/** Restringe a rota a certos perfis: `@Roles("master")` ou `@Roles("user")`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
