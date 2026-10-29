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

/**
 * SHA-256 em hexadecimal. Serve para guardar no banco o HASH de segredos de alta
 * entropia (tokens de sessão e de recuperação, códigos de recuperação) em vez do
 * valor original. Para SENHAS (baixa entropia, adivinháveis) usa-se scrypt, que é
 * propositalmente lento; SHA-256 sozinho seria rápido demais para isso.
 */
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** 256 bits aleatórios (32 bytes do gerador criptográfico do sistema) em hexadecimal: tokens de sessão e de redefinição de senha. Impossível de adivinhar. */
export const token = () => randomBytes(32).toString("hex");

/**
 * Gera o hash da senha com scrypt (função "memory-hard", cara de calcular, o que
 * torna a força bruta lenta) e um SALT aleatório por senha (duas pessoas com a
 * mesma senha têm hashes diferentes, e tabelas pré-calculadas não servem).
 * Devolve "salt:hash"; a senha em si nunca é guardada.
 */
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
/**
 * Confere a senha refazendo o hash com o mesmo salt. A comparação é em TEMPO
 * CONSTANTE (timingSafeEqual): não vaza, pelo tempo de resposta, quantos
 * caracteres iniciais coincidiram. Valor guardado malformado apenas não confere.
 */
export async function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Chave AES-256 vinda do AMBIENTE (64 hexadecimais = 32 bytes). Nunca fica no
 * banco nem no repositório: quem obtém só o banco não consegue decifrar os
 * segredos de 2FA. Se estiver ausente ou malformada, falha em vez de usar um
 * valor padrão inseguro.
 */
function encryptionKey() {
  const key = process.env.TOTP_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid encryption key");
  return Buffer.from(key, "hex");
}
/**
 * Cifra com AES-256-GCM. A saída é "iv.tag.dados" em hexadecimal:
 *   - iv: valor aleatório novo a cada cifragem (nunca reutilizado com a mesma chave);
 *   - tag: selo de autenticidade; se alguém alterar o texto cifrado, a decifragem falha;
 *   - dados: o conteúdo cifrado.
 * GCM garante confidencialidade E integridade ao mesmo tempo.
 */
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("hex")).join(".");
}
/**
 * Reverte `encrypt`. Chave errada, valor truncado ou texto cifrado alterado
 * falham na autenticação do GCM. O erro é normalizado para uma mensagem única,
 * de modo que nenhum detalhe criptográfico vaze para quem o provocou.
 */
export function decrypt(value: string) {
  try {
    const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "hex"));
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new Error("Encrypted value could not be read");
  }
}

/**
 * Gerador TOTP compatível com Google/Microsoft Authenticator (RFC 6238): 6
 * dígitos, renovados a cada 30 segundos, algoritmo SHA-1 (o padrão que esses
 * aplicativos esperam). O `label` aparece no aplicativo ao lado do nome do emissor.
 */
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
/** Novo segredo compartilhado de 160 bits em base32 (o formato do QR code e dos aplicativos). */
export const newSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
/**
 * Número do intervalo de 30 s em que o código é válido, ou null se for inválido.
 * Aceita o intervalo atual e um para cada lado (`window: 1`), compensando
 * pequenas diferenças entre o relógio do celular e o do servidor. Quem chama
 * guarda o número devolvido para recusar o mesmo intervalo duas vezes (replay).
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
