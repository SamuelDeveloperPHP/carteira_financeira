import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, status } from "./helpers/memory.mjs";

// Users are identified by their id; here the id doubles as the e-mail prefix.
const world = (balances = { ana: 10000, bia: 0 }) => {
  const w = createWorld();
  for (const [id, balance] of Object.entries(balances))
    w.addUser(id, `${id}@example.test`, balance);
  return w;
};
const send = (w, from, to, amount, key = "chave-transferencia-1") =>
  w.transfers.transfer(from, { recipientEmail: `${to}@example.test`, amount }, key, w.ctx);
const rejectsWith = (promise, code) =>
  assert.rejects(promise, error => {
    assert.equal(status(error), code);
    return true;
  });

test("transferência debita o remetente, credita o destinatário e os lançamentos somam zero", async () => {
  const w = world();
  const movement = await send(w, "ana", "bia", 3000);
  assert.equal(movement.kind, "transfer");
  assert.equal(w.balance("ana"), 7000);
  assert.equal(w.balance("bia"), 3000);
  assert.deepEqual(w.state.entries.map(e => e.delta).sort((a, b) => a - b), [-3000, 3000]);
  assert.equal(w.state.entries.reduce((sum, e) => sum + e.delta, 0), 0);
  assert.equal(w.state.audit.at(-1).action, "transfer.completed");
});

test("saldo insuficiente é recusado antes de qualquer alteração", async () => {
  const w = world({ ana: 1000, bia: 0 });
  await rejectsWith(send(w, "ana", "bia", 1001), 400);
  assert.equal(w.balance("ana"), 1000);
  assert.equal(w.balance("bia"), 0);
  assert.equal(w.state.movements.length, 0);
  assert.equal(w.state.entries.length, 0);
});

test("o saldo inteiro pode ser transferido (limite exato)", async () => {
  const w = world({ ana: 1000, bia: 0 });
  await send(w, "ana", "bia", 1000);
  assert.equal(w.balance("ana"), 0);
  assert.equal(w.balance("bia"), 1000);
});

test("destinatário inexistente e transferência para si mesmo são recusados", async () => {
  const w = world();
  await rejectsWith(send(w, "ana", "ninguem", 100), 404);
  await rejectsWith(send(w, "ana", "ana", 100), 400);
  assert.equal(w.balance("ana"), 10000);
  assert.equal(w.state.movements.length, 0);
});

test("a mesma solicitação repetida não transfere duas vezes", async () => {
  const w = world();
  const first = await send(w, "ana", "bia", 2000);
  const again = await send(w, "ana", "bia", 2000);
  assert.equal(again.id, first.id);
  assert.equal(w.balance("ana"), 8000);
  assert.equal(w.state.movements.length, 1);
  assert.equal(w.state.audit.at(-1).action, "transfer.replayed");
});

test("reutilizar a chave com outros dados é recusado", async () => {
  const w = world();
  await send(w, "ana", "bia", 2000);
  await rejectsWith(send(w, "ana", "bia", 2500), 409);
  assert.equal(w.balance("ana"), 8000);
});

test("falha no meio da operação desfaz débito, crédito, lançamentos e evidência", async () => {
  const w = world();
  w.failOnCredit = true;
  await assert.rejects(send(w, "ana", "bia", 4000), /falha injetada/);
  assert.equal(w.balance("ana"), 10000);
  assert.equal(w.balance("bia"), 0);
  assert.equal(w.state.movements.length, 0);
  assert.equal(w.state.entries.length, 0);
  assert.equal(w.state.idem.size, 0);
  assert.equal(w.state.audit.length, 0);
  // Retrying the same request after the fault is gone completes exactly once.
  w.failOnCredit = false;
  await send(w, "ana", "bia", 4000);
  await send(w, "ana", "bia", 4000);
  assert.equal(w.balance("ana"), 6000);
  assert.equal(w.state.movements.length, 1);
});

test("o limite máximo da carteira destinatária é respeitado", async () => {
  const w = world({ ana: 100, bia: 1_000_000_000_000 });
  await rejectsWith(send(w, "ana", "bia", 1), 400);
  assert.equal(w.balance("ana"), 100);
});

test("devolução: só o destinatário, integral e uma única vez", async () => {
  const w = world();
  const original = await send(w, "ana", "bia", 3000);
  const refund = key => w.transfers.refund("bia", original.id, key, w.ctx);
  await rejectsWith(w.transfers.refund("ana", original.id, "chave-devolucao-0", w.ctx), 403);
  const done = await refund("chave-devolucao-1");
  assert.equal(done.kind, "refund");
  assert.equal(done.original_id, original.id);
  assert.equal(w.balance("ana"), 10000);
  assert.equal(w.balance("bia"), 0);
  // Same key replays; a new key is refused because it was already refunded.
  assert.equal((await refund("chave-devolucao-1")).id, done.id);
  await rejectsWith(refund("chave-devolucao-2"), 409);
  assert.equal(w.balance("ana"), 10000);
});

test("devolução é recusada se o destinatário já gastou o valor, sem alterar o histórico", async () => {
  const w = world({ ana: 5000, bia: 0, caio: 0 });
  const original = await send(w, "ana", "bia", 3000);
  await send(w, "bia", "caio", 3000, "chave-transferencia-2");
  const movements = w.state.movements.length;
  await rejectsWith(w.transfers.refund("bia", original.id, "chave-devolucao-1", w.ctx), 400);
  assert.equal(w.balance("ana"), 2000);
  assert.equal(w.balance("bia"), 0);
  assert.equal(w.state.movements.length, movements);
});

test("só transferências podem ser devolvidas, não depósitos", async () => {
  const w = world();
  const deposit = await w.deposits().deposit("ana@example.test", 500, "referencia-deposito-1", w.ctx);
  await rejectsWith(w.transfers.refund("ana", deposit.id, "chave-devolucao-1", w.ctx), 403);
});

test("depósito exige o provedor habilitado e é idempotente", async () => {
  const w = world();
  const disabled = { name: "off", confirm: async () => { throw Object.assign(new Error("off"), { getStatus: () => 403 }); } };
  await rejectsWith(w.deposits(disabled).deposit("ana@example.test", 500, "referencia-deposito-1", w.ctx), 403);
  assert.equal(w.balance("ana"), 10000);
  const first = await w.deposits().deposit("ana@example.test", 500, "referencia-deposito-1", w.ctx);
  const again = await w.deposits().deposit("ana@example.test", 500, "referencia-deposito-1", w.ctx);
  assert.equal(again.id, first.id);
  assert.equal(w.balance("ana"), 10500);
  await rejectsWith(w.deposits().deposit("ana@example.test", 999, "referencia-deposito-1", w.ctx), 409);
});

test("depósitos simulados ficam desligados fora da demonstração", async () => {
  const { SimulatedDepositProvider } = (await import("../dist/wallet/deposit.provider.js")).default;
  const previous = process.env.DEMO_DEPOSITS;
  try {
    delete process.env.DEMO_DEPOSITS;
    await rejectsWith(new SimulatedDepositProvider().confirm("referencia-deposito-1"), 403);
    process.env.DEMO_DEPOSITS = "true";
    await new SimulatedDepositProvider().confirm("referencia-deposito-1");
  } finally {
    if (previous === undefined) delete process.env.DEMO_DEPOSITS;
    else process.env.DEMO_DEPOSITS = previous;
  }
});
