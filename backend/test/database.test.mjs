import test from "node:test";
import assert from "node:assert/strict";
import dbModule from "../dist/common/database/database.service.js";

// A pool double that records what the transaction runs and how it is released.
function fakePool({ failRollback = false } = {}) {
  const calls = [];
  const client = {
    query: async sql => {
      calls.push(sql);
      if (sql === "ROLLBACK" && failRollback)
        throw new Error("connection lost");
    },
    release: discard => calls.push(`release:${discard ?? false}`),
  };
  return { calls, pool: { connect: async () => client, end: async () => {} } };
}
const build = options => {
  const { calls, pool } = fakePool(options);
  const db = new dbModule.Database();
  db.pool = pool;
  return { db, calls };
};

test("commit quando o trabalho termina e conexão devolvida ao pool", async () => {
  const { db, calls } = build();
  assert.equal(await db.transaction(async () => "ok"), "ok");
  assert.deepEqual(calls, ["BEGIN", "COMMIT", "release:false"]);
});

test("rollback quando o trabalho falha, preservando o erro original", async () => {
  const { db, calls } = build();
  const cause = new Error("saldo");
  await assert.rejects(
    db.transaction(async () => {
      throw cause;
    }),
    e => e === cause
  );
  assert.deepEqual(calls, ["BEGIN", "ROLLBACK", "release:false"]);
});

test("se o próprio rollback falhar, o erro original continua visível e a conexão é descartada", async () => {
  const { db, calls } = build({ failRollback: true });
  const cause = new Error("causa raiz");
  await assert.rejects(
    db.transaction(async () => {
      throw cause;
    }),
    e => e === cause
  );
  assert.deepEqual(calls, ["BEGIN", "ROLLBACK", "release:true"]);
});
