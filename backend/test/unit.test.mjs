import test from "node:test";
import assert from "node:assert/strict";
import security from "../dist/security.js";
import { randomBytes } from "node:crypto";
const {
  money,
  location,
  hashPassword,
  checkPassword,
  encrypt,
  decrypt,
  totp,
  totpStep,
  newSecret,
  object,
} = security;
test("valores monetários exigem centavos inteiros positivos e limitados", () => {
  for (const value of [0, -1, 1.1, NaN, Infinity, "100", 1000000000001])
    assert.throws(() => money(value));
  assert.equal(money(12345), 12345);
});
test("localização valida coordenadas, precisão e consentimento", () => {
  assert.deepEqual(location({ status: "denied", latitude: 1 }), {
    status: "denied",
  });
  assert.throws(() =>
    location({
      status: "granted",
      latitude: 91,
      longitude: 0,
      accuracy: 5,
      capturedAt: new Date().toISOString(),
    })
  );
  assert.throws(() =>
    location({
      status: "granted",
      latitude: 0,
      longitude: 0,
      accuracy: -1,
      capturedAt: new Date().toISOString(),
    })
  );
  assert.equal(
    location({
      status: "granted",
      latitude: -23.5,
      longitude: -46.6,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
    }).source,
    "browser_unverified"
  );
});
test("senhas são derivadas com salt e validadas sem modificar espaços", async () => {
  const a = await hashPassword(" senha-com-espacos "),
    b = await hashPassword(" senha-com-espacos ");
  assert.notEqual(a, b);
  assert(await checkPassword(" senha-com-espacos ", a));
  assert.equal(await checkPassword("senha-com-espacos", a), false);
});
test("segredo TOTP é cifrado e alterações no conteúdo são detectadas", () => {
  process.env.TOTP_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
  const secret = newSecret();
  const encrypted = encrypt(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decrypt(encrypted), secret);
  const parts = encrypted.split(".");
  parts[1] = (parts[1][0] === "0" ? "1" : "0") + parts[1].slice(1);
  assert.throws(() => decrypt(parts.join(".")));
  const code = totp(secret).generate();
  assert.notEqual(totpStep(secret, code), null);
});
test("campos administrativos e valores desconhecidos são recusados", () =>
  assert.throws(() => object({ name: "Nome", role: "master" }, ["name"])));
