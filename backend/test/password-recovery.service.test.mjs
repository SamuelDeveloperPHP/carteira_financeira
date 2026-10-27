import test from "node:test";
import assert from "node:assert/strict";
import recoveryModule from "../dist/auth/password-recovery.service.js";
import crypto from "../dist/common/security/crypto.js";

const { digest, checkPassword } = crypto;

function setup() {
  const state = {
    users: new Map([
      ["ana@example.test", { id: "u1", email: "ana@example.test", password_hash: "antigo" }],
    ]),
    resets: new Map(),
    sessionsDeletedFor: [],
    audit: [],
    mails: [],
    throttles: [],
  };
  const db = { transaction: work => work({}) };
  const users = {
    findByEmail: async email => state.users.get(email),
    lockById: async () => {},
    setPassword: async (_q, id, hash) => {
      for (const u of state.users.values()) if (u.id === id) u.password_hash = hash;
    },
  };
  const resets = {
    issue: async (_q, userId, hash, minutes) => {
      for (const [h, r] of state.resets) if (r.userId === userId) state.resets.delete(h);
      state.resets.set(hash, { userId, minutes });
    },
    consume: async (_q, hash) => {
      const row = state.resets.get(hash);
      state.resets.delete(hash);
      return row?.userId;
    },
    deleteForUser: async (_q, userId) => {
      for (const [h, r] of state.resets) if (r.userId === userId) state.resets.delete(h);
    },
  };
  const sessions = { deleteByUser: async (_q, id) => state.sessionsDeletedFor.push(id) };
  const audit = { record: async (action, actor, _r, _c, _d, outcome = "success") => state.audit.push({ action, actor, outcome }) };
  const limiter = { throttle: async (key, limit) => state.throttles.push([key, limit]) };
  const mail = {
    name: "test",
    sendPasswordReset: async (to, token, minutes) => state.mails.push({ to, token, minutes }),
  };
  const service = new recoveryModule.PasswordRecoveryService(db, users, resets, sessions, audit, limiter, mail);
  const req = { ip: "127.0.0.1", correlationId: "c", headers: {} };
  return { state, service, req };
}

test("o pedido responde igual para e-mail cadastrado ou desconhecido", async () => {
  const { state, service, req } = setup();
  const known = await service.forgot({ email: "ana@example.test" }, { ...req });
  const unknown = await service.forgot({ email: "ninguem@example.test" }, { ...req });
  assert.deepEqual(known, unknown);
  assert.match(known.message, /7 minutos/);
  assert.equal(state.mails.length, 1);
  assert.equal(state.mails[0].to, "ana@example.test");
  assert.equal(state.mails[0].minutes, 7);
  assert.equal(state.audit.at(-1).outcome, "denied");
  assert.deepEqual(state.throttles.slice(0, 2), [["forgot-ip:127.0.0.1", 10], ["forgot-email:ana@example.test", 3]]);
});

test("só o hash do token é guardado e um novo pedido invalida o anterior", async () => {
  const { state, service, req } = setup();
  await service.forgot({ email: "ana@example.test" }, { ...req });
  await service.forgot({ email: "ana@example.test" }, { ...req });
  const [first, second] = state.mails.map(m => m.token);
  assert.equal(state.resets.size, 1);
  assert(!state.resets.has(first) && !state.resets.has(second));
  assert(state.resets.has(digest(second)));
  await assert.rejects(service.reset({ token: first, password: "uma-senha-bem-longa" }, { ...req }), e => e.getStatus() === 400);
});

test("a redefinição troca a senha, encerra sessões e o token vale uma vez", async () => {
  const { state, service, req } = setup();
  await service.forgot({ email: "ana@example.test" }, { ...req });
  const { token } = state.mails[0];
  const result = await service.reset({ token, password: "uma-senha-bem-longa" }, { ...req });
  assert.match(result.message, /segundo fator/);
  assert(await checkPassword("uma-senha-bem-longa", state.users.get("ana@example.test").password_hash));
  assert.deepEqual(state.sessionsDeletedFor, ["u1"]);
  assert.equal(state.audit.at(-1).action, "auth.password.reset");
  await assert.rejects(service.reset({ token, password: "outra-senha-bem-longa" }, { ...req }), e => e.getStatus() === 400);
  assert(await checkPassword("uma-senha-bem-longa", state.users.get("ana@example.test").password_hash));
});

test("falha no envio do e-mail não revela nem derruba o pedido", async () => {
  const { state, service, req } = setup();
  const original = console.error;
  console.error = () => {};
  try {
    const failing = new recoveryModule.PasswordRecoveryService(
      { transaction: work => work({}) },
      { findByEmail: async () => state.users.get("ana@example.test") },
      { issue: async () => {} },
      {},
      { record: async () => {} },
      { throttle: async () => {} },
      { name: "x", sendPasswordReset: async () => { throw new Error("smtp"); } }
    );
    const answer = await failing.forgot({ email: "ana@example.test" }, { ...req });
    assert.match(answer.message, /7 minutos/);
  } finally {
    console.error = original;
  }
});
