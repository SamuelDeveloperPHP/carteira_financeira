import { SetMetadata } from "@nestjs/common";
import { Role } from "./request.types";

// public:     no session needed (register, login, health, password recovery)
// any-stage:  any valid session, even before the second factor (status, logout)
// partial:    session still in the 2FA flow (setup, verify)
// default:    complete session with 2FA enabled
export type AccessLevel = "public" | "any-stage" | "partial";

export const ACCESS_KEY = "access";
export const ROLES_KEY = "roles";

export const Access = (level: AccessLevel) => SetMetadata(ACCESS_KEY, level);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
