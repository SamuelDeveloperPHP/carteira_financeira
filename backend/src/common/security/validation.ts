import { BadRequestException } from "@nestjs/common";
import { MAX_CENTS } from "../constants";

// Imperative validators for input that does not arrive through a DTO
// (operator CLI, idempotency header, location payload).
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function object(value: unknown, allowed: string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(k => !allowed.includes(k))
  )
    throw new BadRequestException("Campos inválidos.");
  return value as Record<string, any>;
}
export function text(value: unknown, min = 1, max = 100): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw new BadRequestException("Texto inválido.");
  return value.trim();
}
export function email(value: unknown) {
  const result = text(value, 3, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(result))
    throw new BadRequestException("E-mail inválido.");
  return result;
}
export function password(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new BadRequestException("Use uma senha com 12 a 128 caracteres.");
  return value;
}
export function money(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CENTS
  )
    throw new BadRequestException(
      "Valor deve ser positivo, em centavos inteiros."
    );
  return value;
}
export function uuid(value: unknown) {
  const v = text(value, 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  )
    throw new BadRequestException("Identificador inválido.");
  return v;
}
export function idempotencyKey(value: unknown) {
  const v = text(value, 8, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(v))
    throw new BadRequestException("Identificação da solicitação inválida.");
  return v;
}
export function location(value: unknown) {
  if (value === undefined) return { status: "unavailable" };
  const v = object(value, [
    "status",
    "latitude",
    "longitude",
    "accuracy",
    "capturedAt",
  ]);
  if (!["granted", "denied", "unavailable", "timeout"].includes(v.status))
    throw new BadRequestException("Estado da localização inválido.");
  if (v.status !== "granted") return { status: v.status };
  if (
    !Number.isFinite(v.latitude) ||
    Math.abs(v.latitude) > 90 ||
    !Number.isFinite(v.longitude) ||
    Math.abs(v.longitude) > 180 ||
    !Number.isFinite(v.accuracy) ||
    v.accuracy < 0 ||
    v.accuracy > 20000000 ||
    typeof v.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(v.capturedAt))
  )
    throw new BadRequestException("Localização inválida.");
  return {
    status: "granted",
    latitude: v.latitude,
    longitude: v.longitude,
    accuracy: v.accuracy,
    capturedAt: new Date(v.capturedAt).toISOString(),
    source: "browser_unverified",
  };
}
