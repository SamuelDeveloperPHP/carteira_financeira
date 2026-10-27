import { BadRequestException } from "@nestjs/common";
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";

const derive = promisify(scrypt);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function encryptionKey() {
  const key = process.env.TOTP_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid encryption key");
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("hex")).join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "hex"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function totp(secret: string, email = "Carteira") {
  return new OTPAuth.TOTP({
    issuer: "Carteira Financeira · Demo",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export const newSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
export function totpStep(secret: string, code: string) {
  const now = Date.now();
  const delta = totp(secret).validate({
    token: code,
    timestamp: now,
    window: 1,
  });
  return delta === null ? null : Math.floor(now / 30000) + delta;
}
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
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
    value > 1000000000000
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
export function context(req: any) {
  return {
    correlationId: req.correlationId || randomUUID(),
    ip: (req.ip || "unknown").slice(0, 80),
    device: String(req.headers?.["user-agent"] || "unknown").slice(0, 500),
    location: req.accessLocation ||
      req.auth?.context?.location || { status: "unavailable" },
  };
}
export function page(value: unknown) {
  if (value === undefined) return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10000)
    throw new BadRequestException("Página inválida.");
  return n;
}
