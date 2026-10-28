import test from "node:test";
import assert from "node:assert/strict";
import rules from "../dist/banking/pix-key.rules.js";
import bankingModule from "../dist/banking/banking.service.js";
import faceMatching from "../dist/settings/face-matching.js";
import faceModule from "../dist/settings/face.service.js";
import crypto from "../dist/common/security/crypto.js";

process.env.TOTP_ENCRYPTION_KEY ||= "ab".repeat(32);
const ctx = { correlationId: "c", ip: "127.0.0.1", device: "test", location: { status: "unavailable" } };
const status = code => e => e.getStatus?.() === code;

// ---------------------------------------------------------------------------
// Regras de formato das chaves Pix
// ---------------------------------------------------------------------------
test("CPF e CNPJ são validados pelos dígitos verificadores", () => {
  assert(rules.isValidCpf("529.982.247-25"));
  assert(!rules.isValidCpf("529.982.247-24"));
  assert(!rules.isValidCpf("111.111.111-11"));
  assert(rules.isValidCnpj("11.222.333/0001-81"));
  assert(!rules.isValidCnpj("11.222.333/0001-80"));
  assert.equal(rules.holderDocument("529.982.247-25"), "52998224725");
  assert.throws(() => rules.holderDocument("123"), status(400));
});

test("telefone vira +55DDDnúmero e só celular é aceito", () => {
  assert.equal(rules.normalizePhone("(61) 99999-9999"), "+5561999999999");
  assert.equal(rules.normalizePhone("+55 61 99999-9999"), "+5561999999999");
  assert.throws(() => rules.normalizePhone("(61) 3333-4444"), status(400));
});

test("a chave CPF/CNPJ precisa ser o documento do titular; a aleatória é gerada aqui", () => {
  const holder = "52998224725";
  assert.equal(rules.normalizePixKey("cpf", "529.982.247-25", holder), holder);
  assert.throws(() => rules.normalizePixKey("cpf", "111.444.777-35", holder), status(400));
  assert.equal(rules.normalizePixKey("email", " Ana@Example.TEST ", holder), "ana@example.test");
  assert.match(rules.normalizePixKey("evp", undefined, holder), /^[0-9a-f-]{36}$/);
  assert.notEqual(rules.normalizePixKey("evp", "ignorado", holder), "ignorado");
});

test("limite de chaves: 5 para CPF e 20 para CNPJ", () => {
  assert.equal(rules.maxKeysPerAccount("52998224725"), 5);
  assert.equal(rules.maxKeysPerAccount("11222333000181"), 20);
});

// ---------------------------------------------------------------------------
// BankingService com repositório em memória
// ---------------------------------------------------------------------------
function banking() {
  const state = { accounts: [], keys: [], codes: [], audit: [] };
  const holder = "52998224725";
  state.accounts.push({ id: "acc1", user_id: "u1", bank_code: "260", agency: "0001", account_number: "123456-7", holder_document: holder });
  const repo = {
    findAccount: async (u, id) => state.accounts.find(a => a.id === id && a.user_id === u),
    lockAccount: async (_q, u, id) => state.accounts.find(a => a.id === id && a.user_id === u),
    keyExists: async v => state.keys.some(k => k.key_value === v),
    countKeys: async (_q, id) => state.keys.filter(k => k.bank_account_id === id).length,
    insertKey: async (_q, k) => {
      // Reproduz o UNIQUE global do banco.
      if (state.keys.some(x => x.key_value === k.value)) throw Object.assign(new Error("dup"), { code: "23505" });
      state.keys.push({
        id: k.id, bank_account_id: k.accountId, user_id: k.userId, key_type: k.type, key_value: k.value,
        status: k.status, protocol: k.protocol, proof_hash: k.proofHash, proof_attempts: 0,
        proof_expires_at: k.proofMinutes ? new Date(Date.now() + 60000) : null,
      });
    },
    lockKey: async (_q, u, id) => state.keys.find(k => k.id === id && k.user_id === u),
    approveKey: async (_q, id) => { Object.assign(state.keys.find(k => k.id === id), { status: "approved", proof_hash: null }); },
    addProofAttempt: async id => { state.keys.find(k => k.id === id).proof_attempts++; },
    renewProof: async (_q, id, hash) => { Object.assign(state.keys.find(k => k.id === id), { proof_hash: hash, proof_attempts: 0 }); },
    deleteKey: async (_q, u, id) => {
      const i = state.keys.findIndex(k => k.id === id && k.user_id === u);
      if (i >= 0) state.keys.splice(i, 1);
      return i >= 0;
    },
  };
  const directory = {
    name: "test",
    submit: async r => ({ status: ["email", "phone"].includes(r.type) ? "awaiting_ownership" : "approved", protocol: "P1" }),
    sendOwnershipCode: async (_t, _v, code) => state.codes.push(code),
    confirm: async protocol => ({ status: "approved", protocol }),
  };
  const db = { transaction: work => work({}) };
  const audit = { record: async a => state.audit.push(a) };
  const limiter = { throttle: async () => {} };
  const service = new bankingModule.BankingService(db, repo, audit, limiter, directory);
  return { state, service };
}

test("chave CPF do titular é aprovada na hora; a mesma chave não se repete", async () => {
  const { service, state } = banking();
  const r = await service.addKey("u1", "acc1", { type: "cpf", value: "529.982.247-25" }, ctx);
  assert.equal(r.status, "approved");
  await assert.rejects(service.addKey("u1", "acc1", { type: "cpf", value: "52998224725" }, ctx), status(409));
  assert.equal(state.keys.length, 1);
});

test("a corrida pelo UNIQUE do banco também vira 409", async () => {
  const { service, state } = banking();
  // Simula a chave aparecer entre a verificação antecipada e o INSERT.
  const original = service.repo.keyExists;
  service.repo.keyExists = async () => false;
  state.keys.push({ id: "k0", bank_account_id: "acc2", user_id: "u2", key_value: "52998224725", key_type: "cpf", status: "approved" });
  await assert.rejects(service.addKey("u1", "acc1", { type: "cpf", value: "52998224725" }, ctx), status(409));
  service.repo.keyExists = original;
});

test("e-mail fica pendente até o código de posse; código errado não aprova", async () => {
  const { service, state } = banking();
  const { id, status: st } = await service.addKey("u1", "acc1", { type: "email", value: "Ana@Example.test" }, ctx);
  assert.equal(st, "pending");
  assert.equal(state.codes.length, 1);
  // Só o hash do código fica guardado.
  assert.notEqual(state.keys[0].proof_hash, state.codes[0]);
  const wrong = state.codes[0] === "000000" ? "111111" : "000000";
  await assert.rejects(service.confirmKey("u1", id, { code: wrong }, ctx), status(422));
  assert.equal(state.keys[0].proof_attempts, 1);
  assert.equal(state.keys[0].status, "pending");
  const ok = await service.confirmKey("u1", id, { code: state.codes[0] }, ctx);
  assert.match(ok.message, /aprovada/);
  assert.equal(state.keys[0].status, "approved");
});

test("depois de 5 erros o código esgota e é preciso pedir outro", async () => {
  const { service, state } = banking();
  const { id } = await service.addKey("u1", "acc1", { type: "phone", value: "(61) 99999-9999" }, ctx);
  const real = state.codes[0];
  const wrong = real === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await assert.rejects(service.confirmKey("u1", id, { code: wrong }, ctx), status(422));
  // Mesmo o código certo é recusado após o esgotamento.
  await assert.rejects(service.confirmKey("u1", id, { code: real }, ctx), /Tentativas esgotadas/);
  await service.resendCode("u1", id, ctx);
  await service.confirmKey("u1", id, { code: state.codes.at(-1) }, ctx);
  assert.equal(state.keys[0].status, "approved");
});

test("uma conta de pessoa física aceita no máximo 5 chaves", async () => {
  const { service } = banking();
  for (let i = 0; i < 5; i++) await service.addKey("u1", "acc1", { type: "evp" }, ctx);
  await assert.rejects(service.addKey("u1", "acc1", { type: "evp" }, ctx), status(422));
});

test("conta e chave de outro usuário são tratadas como inexistentes", async () => {
  const { service } = banking();
  await assert.rejects(service.addKey("intruso", "acc1", { type: "evp" }, ctx), status(404));
  const { id } = await service.addKey("u1", "acc1", { type: "email", value: "a@b.co" }, ctx);
  await assert.rejects(service.confirmKey("intruso", id, { code: "123456" }, ctx), status(404));
  await assert.rejects(service.removeKey("intruso", id, ctx), status(404));
});

test("queda do diretório vira 503 e nada é gravado", async () => {
  const { service, state } = banking();
  service.directory.submit = async () => { throw new Error("fora do ar"); };
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(service.addKey("u1", "acc1", { type: "evp" }, ctx), status(503));
  } finally {
    console.error = original;
  }
  assert.equal(state.keys.length, 0);
});

// ---------------------------------------------------------------------------
// Reconhecimento facial
// ---------------------------------------------------------------------------
const vector = (seed = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i + seed) / 4);

test("o vetor facial é validado: tamanho, números finitos e faixa", () => {
  assert.equal(faceMatching.parseDescriptor(vector()).length, 128);
  assert.throws(() => faceMatching.parseDescriptor([1, 2, 3]), status(400));
  assert.throws(() => faceMatching.parseDescriptor(Array(128).fill("a")), status(400));
  assert.throws(() => faceMatching.parseDescriptor(Array(128).fill(99)), status(400));
  assert.equal(faceMatching.faceDistance(vector(), vector()), 0);
});

async function faces() {
  const state = { template: undefined, enabled: false, audit: [] };
  const hash = await crypto.hashPassword("senha-bem-comprida-1");
  const repo = {
    saveTemplate: async (_q, _u, enc) => { state.template = enc; },
    update: async (_q, _u, c) => { if (c.face !== undefined) state.enabled = c.face; },
    deleteTemplate: async () => { state.template = undefined; },
    get: async () => ({ face_enabled: state.enabled }),
    template: async () => state.template,
  };
  const users = { findById: async () => ({ password_hash: hash }) };
  const audit = { record: async (action, _a, _r, _c, _d, outcome = "success") => state.audit.push({ action, outcome }) };
  const limiter = { throttle: async () => {} };
  const service = new faceModule.FaceService({ transaction: work => work({}) }, repo, users, audit, limiter);
  return { state, service };
}
const steps = ["right", "left", "down", "up", "smile"];

test("o cadastro facial exige senha e as cinco etapas, e guarda o vetor cifrado", async () => {
  const { service, state } = await faces();
  await assert.rejects(service.enroll("u1", { password: "errada", descriptor: vector(), liveness: steps }, ctx), status(401));
  await assert.rejects(service.enroll("u1", { password: "senha-bem-comprida-1", descriptor: vector(), liveness: ["right", "right", "left", "up", "down"] }, ctx), status(422));
  await service.enroll("u1", { password: "senha-bem-comprida-1", descriptor: vector(), liveness: steps }, ctx);
  assert.equal(state.enabled, true);
  // Nada do vetor aparece em claro.
  assert(!state.template.includes("0."));
});

test("a verificação aceita o mesmo rosto e recusa outro", async () => {
  const { service, state } = await faces();
  await service.enroll("u1", { password: "senha-bem-comprida-1", descriptor: vector(), liveness: steps }, ctx);
  // Leve variação de captura: dentro do limite.
  const similar = vector().map(n => n + 0.005);
  await service.assertMatch("u1", similar, ctx);
  await assert.rejects(service.assertMatch("u1", vector(50), ctx), e => e.getStatus() === 403 && e.userId === "u1");
  // A recusa é auditada por quem captura a exceção, depois do rollback.
  await service.auditMismatch("u1", ctx);
  assert.equal(state.audit.at(-1).outcome, "denied");
});

test("desativar apaga o modelo e exige a senha", async () => {
  const { service, state } = await faces();
  await service.enroll("u1", { password: "senha-bem-comprida-1", descriptor: vector(), liveness: steps }, ctx);
  await assert.rejects(service.disable("u1", { password: "errada" }, ctx), status(401));
  await service.disable("u1", { password: "senha-bem-comprida-1" }, ctx);
  assert.equal(state.template, undefined);
  assert.equal(state.enabled, false);
});
