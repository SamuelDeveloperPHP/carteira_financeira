import test from "node:test";
import assert from "node:assert/strict";
import rules from "../dist/insights/insights.rules.js";

const base = {
  days: 30,
  balance: 100000,
  income: 100000,
  expense: 40000,
  movements: 5,
  sentCount: 2,
  biggestOut: 20000,
  topOutflow: null,
  refundsSent: 0,
  refundsReceived: 0,
};
const ids = list => list.map(s => s.id);

test("sem movimentações, a única sugestão é começar a usar a carteira", () => {
  const list = rules.buildSuggestions({ ...base, movements: 0, income: 0, expense: 0 });
  assert.deepEqual(ids(list), ["no-activity"]);
});

test("entradas maiores que saídas geram sugestão de sucesso", () => {
  const list = rules.buildSuggestions(base);
  assert(ids(list).includes("positive-net"));
  assert(!ids(list).includes("outflows-above-inflows"));
  assert.match(list.find(s => s.id === "positive-net").message, /R\$ 600,00/);
});

test("saídas acima das entradas geram alerta com o percentual", () => {
  const list = rules.buildSuggestions({ ...base, income: 10000, expense: 15000 });
  const s = list.find(x => x.id === "outflows-above-inflows");
  assert.equal(s.level, "warning");
  assert.match(s.message, /50%/);
  // Alertas vêm antes das sugestões informativas e de sucesso.
  assert.equal(list[0].level, "warning");
});

test("só saídas, sem nenhuma entrada, é alerta próprio (sem divisão por zero)", () => {
  const list = rules.buildSuggestions({ ...base, income: 0, expense: 5000 });
  assert(ids(list).includes("only-outflows"));
  assert(list.every(s => !/Infinity|NaN/.test(s.message)));
});

test("fôlego do saldo: poucos dias vira alerta, muitos dias é informativo", () => {
  // 30 dias, R$ 3.000 de saída: R$ 100/dia. Saldo de R$ 300 cobre 3 dias.
  const low = rules.buildSuggestions({ ...base, expense: 300000, balance: 30000 });
  assert.equal(low.find(s => s.id === "low-runway").level, "warning");
  const ok = rules.buildSuggestions({ ...base, expense: 30000, balance: 100000 });
  assert.equal(ok.find(s => s.id === "runway").level, "info");
});

test("concentração e saída atípica exigem quantidade mínima de operações", () => {
  const few = rules.buildSuggestions({ ...base, sentCount: 2, topOutflow: { name: "Ana", share: 0.9 } });
  assert(!ids(few).includes("concentration"));
  const many = rules.buildSuggestions({ ...base, sentCount: 4, expense: 40000, biggestOut: 35000, topOutflow: { name: "Ana", share: 0.8 } });
  assert(ids(many).includes("concentration"));
  assert.match(many.find(s => s.id === "concentration").message, /Ana.*80%/);
  assert(ids(many).includes("atypical-outflow"));
});

test("devoluções feitas e recebidas são informadas", () => {
  const list = rules.buildSuggestions({ ...base, refundsSent: 2, refundsReceived: 1 });
  assert(ids(list).includes("refunds-sent") && ids(list).includes("refunds-received"));
});
