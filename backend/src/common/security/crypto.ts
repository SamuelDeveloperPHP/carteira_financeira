import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";

const derive = promisify(scrypt);

/** SHA-256 hex. For high-entropy secrets (tokens, codes) stored instead of the raw value. */
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** 256-bit random value, hex encoded: session and password-reset tokens. */
export const token = () => randomBytes(32).toString("hex");

/** scrypt with a per-password random salt; returns "salt:hash". */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
/** Constant-time comparison; malformed stored values simply do not match. */
export async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** AES key from the environment; never stored in the database or the repository. */
function encryptionKey() {
  const key = process.env.TOTP_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid encryption key");
  return Buffer.from(key, "hex");
}
/** AES-256-GCM; output is "iv.tag.data" in hex. The tag detects tampering. */
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("hex")).join(".");
}
/**
 * Reverses `encrypt`. A wrong key, truncated value or altered ciphertext fails
 * authentication; the error is normalised so no cryptographic detail leaks.
 */
export function decrypt(value: string) {
  try {
    const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "hex"));
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
  } catch {
    throw new Error("Encrypted value could not be read");
  }
}

/** TOTP generator compatible with Google/Microsoft Authenticator (RFC 6238). */
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
/** New 160-bit shared secret, base32 encoded. */
export const newSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
/**
 * Time-step number of an accepted code (tolerance of one 30 s step either way),
 * or null if invalid. Callers store it to reject the same step twice (replay).
 */
export function totpStep(secret: string, code: string) {
  const now = Date.now();
  const delta = totp(secret).validate({
    token: code,
    timestamp: now,
    window: 1,
  });
  return delta === null ? null : Math.floor(now / 30000) + delta;
}
