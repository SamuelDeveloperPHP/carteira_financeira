import test from "node:test";
import assert from "node:assert/strict";
import guardModule from "../dist/common/http/access.guard.js";

const throttled = [];
const sessions = {
  none: async () => {
    const e = new Error("sem sessão");
    e.getStatus = () => 401;
    throw e;
  },
};
const build = ({ meta = {}, session } = {}) => {
  const reflector = { getAllAndOverride: key => meta[key] };
  const auth = { session: session ?? sessions.none };
  const limiter = { throttle: async (...args) => throttled.push(args) };
  return new guardModule.AccessGuard(reflector, auth, limiter);
};
const context = (req = {}) => ({
  switchToHttp: () => ({
    getRequest: () => ({
      method: "GET",
      headers: {},
      cookies: { wallet_session: "a".repeat(64) },
      ...req,
    }),
  }),
  getHandler: () => ({}),
  getClass: () => ({}),
});
const trusted = {
  headers: { origin: "http://localhost:3080", "x-wallet-request": "1" },
};
const session = (over = {}) => async () => ({
  user_id: "u1",
  stage: "full",
  totp_enabled: true,
  role: "user",
  ...over,
});
const forbids = (promise, message) =>
  assert.rejects(promise, e => {
    assert.equal(e.getStatus(), 403);
    if (message) assert.equal(e.message, message);
    return true;
  });

test("POST sem origem confiável e sem cabeçalho próprio é recusado mesmo em rota pública", async () => {
  const guard = build({ meta: { access: "public" } });
  await forbids(guard.canActivate(context({ method: "POST" })), "Origem da solicitação não autorizada.");
  await forbids(
    guard.canActivate(context({ method: "POST", headers: { origin: "https://evil.example", "x-wallet-request": "1" } }))
  );
  await forbids(
    guard.canActivate(context({ method: "POST", headers: { origin: "http://localhost:3080" } }))
  );
  assert.equal(await guard.canActivate(context({ method: "POST", ...trusted })), true);
});

test("rotas públicas não consultam a sessão", async () => {
  assert.equal(await build({ meta: { access: "public" } }).canActivate(context()), true);
});

test("sem sessão válida a requisição é barrada", async () => {
  await assert.rejects(build().canActivate(context()), e => e.getStatus() === 401);
});

test("sessão parcial (2FA pendente) não acessa rotas financeiras", async () => {
  for (const stage of ["setup", "challenge"])
    await forbids(
      build({ session: session({ stage }) }).canActivate(context()),
      "Conclua a autenticação em dois fatores."
    );
  await forbids(
    build({ session: session({ totp_enabled: false }) }).canActivate(context()),
    "Conclua a autenticação em dois fatores."
  );
});

test("fluxo do segundo fator só aceita sessão parcial; status e logout aceitam qualquer etapa", async () => {
  const partial = build({ meta: { access: "partial" }, session: session({ stage: "challenge", totp_enabled: true }) });
  assert.equal(await partial.canActivate(context()), true);
  await forbids(
    build({ meta: { access: "partial" }, session: session() }).canActivate(context()),
    "Reinicie o fluxo de autenticação."
  );
  const any = build({ meta: { access: "any-stage" }, session: session({ stage: "setup", totp_enabled: false }) });
  assert.equal(await any.canActivate(context()), true);
});

test("o master é barrado nas rotas de usuário e o usuário nas de master", async () => {
  await forbids(
    build({ meta: { roles: ["user"] }, session: session({ role: "master" }) }).canActivate(context()),
    "O master tem acesso somente para auditoria."
  );
  await forbids(
    build({ meta: { roles: ["master"] }, session: session({ role: "user" }) }).canActivate(context()),
    "Acesso restrito ao master."
  );
  assert.equal(
    await build({ meta: { roles: ["master"] }, session: session({ role: "master" }) }).canActivate(context()),
    true
  );
});

test("escritas autenticadas passam por limite por usuário", async () => {
  throttled.length = 0;
  const guard = build({ session: session() });
  await guard.canActivate(context({ method: "POST", ...trusted }));
  assert.deepEqual(throttled, [["write:u1", 120, 60]]);
  throttled.length = 0;
  await guard.canActivate(context());
  assert.equal(throttled.length, 0);
});
