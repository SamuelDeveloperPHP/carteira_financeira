import test from "node:test";
import assert from "node:assert/strict";
import pipeModule from "../dist/common/dto/validation-pipe.js";
import authDto from "../dist/auth/dto/auth.dto.js";
import walletDto from "../dist/wallet/dto/wallet.dto.js";
import adminDto from "../dist/admin/dto/admin.dto.js";
import pageDto from "../dist/common/dto/page-query.dto.js";

// The same pipe configuration the application registers globally.
const pipe = pipeModule.createValidationPipe();
const parse = (metatype, value, type = "body") =>
  pipe.transform(value, { type, metatype });
const rejects = async (metatype, value, message, type = "body") => {
  await assert.rejects(parse(metatype, value, type), error => {
    assert.equal(error.getStatus(), 400);
    if (message) assert.equal(error.message, message);
    return true;
  });
};

test("transferência aceita centavos inteiros e normaliza o e-mail", async () => {
  const dto = await parse(walletDto.TransferDto, {
    recipientEmail: "  Bia@Example.TEST ",
    amount: 2550,
  });
  assert.equal(dto.recipientEmail, "bia@example.test");
  assert.equal(dto.amount, 2550);
});

test("valores inválidos de transferência são recusados", async () => {
  for (const amount of [0, -5, 1.5, "100", null, undefined, 1_000_000_000_001, NaN])
    await rejects(
      walletDto.TransferDto,
      { recipientEmail: "bia@example.test", amount },
      "Valor deve ser positivo, em centavos inteiros."
    );
  await rejects(
    walletDto.TransferDto,
    { recipientEmail: "sem-arroba", amount: 100 },
    "E-mail inválido."
  );
});

test("adição de saldo aceita até R$ 10.000,00 e recusa valores inválidos ou campos extras", async () => {
  assert.equal((await parse(walletDto.DepositDto, { amount: 1000000 })).amount, 1000000);
  await rejects(walletDto.DepositDto, { amount: 1000001 }, "O valor máximo por adição é R$ 10.000,00.");
  for (const amount of [0, -5, 1.5, "100", null, undefined])
    await rejects(walletDto.DepositDto, { amount }, "Valor deve ser positivo, em centavos inteiros.");
  // A carteira de destino nunca vem do corpo: campo extra derruba a requisição.
  await rejects(walletDto.DepositDto, { amount: 100, userId: "outro" }, "Campos inválidos.");
});

test("campos desconhecidos não passam, evitando escalonamento de perfil", async () => {
  await rejects(
    authDto.RegisterDto,
    { name: "Ana", email: "ana@example.test", password: "senha-com-12-chars", role: "master" },
    "Campos inválidos."
  );
  await rejects(
    walletDto.TransferDto,
    { recipientEmail: "bia@example.test", amount: 100, senderId: "outro" },
    "Campos inválidos."
  );
  await rejects(walletDto.RefundDto, { amount: 1 }, "Campos inválidos.");
  await parse(walletDto.RefundDto, {});
});

test("cadastro exige senha de 12 a 128 caracteres e limpa o nome", async () => {
  const ok = await parse(authDto.RegisterDto, {
    name: "  Ana Souza ",
    email: "ANA@example.test",
    password: "doze-caracteres",
  });
  assert.equal(ok.name, "Ana Souza");
  assert.equal(ok.email, "ana@example.test");
  assert.equal(ok.password, "doze-caracteres");
  for (const password of ["curta", "x".repeat(129), 123456789012, null])
    await rejects(
      authDto.RegisterDto,
      { name: "Ana", email: "ana@example.test", password },
      "Use uma senha com 12 a 128 caracteres."
    );
});

test("a senha digitada é preservada sem remover espaços", async () => {
  const dto = await parse(authDto.LoginDto, {
    email: "ana@example.test",
    password: "  espaços importam  ",
  });
  assert.equal(dto.password, "  espaços importam  ");
});

test("localização do login é opcional, mas validada quando enviada", async () => {
  await parse(authDto.LoginDto, { email: "ana@example.test", password: "x" });
  await parse(authDto.LoginDto, {
    email: "ana@example.test",
    password: "x",
    location: { status: "denied" },
  });
  await rejects(
    authDto.LoginDto,
    {
      email: "ana@example.test",
      password: "x",
      location: { status: "granted", latitude: 99, longitude: 0, accuracy: 1, capturedAt: new Date().toISOString() },
    },
    "Localização inválida."
  );
});

test("códigos aceitam separadores e o link de recuperação exige 64 hexadecimais", async () => {
  assert.equal((await parse(authDto.VerifyDto, { code: " 123-456 " })).code, "123456");
  assert.equal(
    (await parse(authDto.VerifyDto, { code: "A2AD 37E8-F149 1B61" })).code,
    "a2ad37e8f1491b61"
  );
  await rejects(authDto.VerifyDto, { code: "12" }, "Código inválido.");
  await rejects(
    authDto.ResetPasswordDto,
    { token: "abc", password: "senha-com-12-chars" },
    "Link inválido ou expirado."
  );
  await parse(authDto.ResetPasswordDto, {
    token: "a".repeat(64),
    password: "senha-com-12-chars",
  });
});

test("paginação converte texto em número e recusa valores fora da faixa", async () => {
  assert.equal((await parse(pageDto.PageQueryDto, { page: "3" }, "query")).page, 3);
  assert.equal((await parse(pageDto.PageQueryDto, {}, "query")).page, undefined);
  for (const page of ["abc", "0", "-1", "1.5", "10001", ""])
    await rejects(pageDto.PageQueryDto, { page }, "Página inválida.", "query");
  await rejects(pageDto.PageQueryDto, { userId: "x" }, "Campos inválidos.", "query");
});

test("filtros administrativos validam identificador, resultado e datas", async () => {
  const ok = await parse(
    adminDto.EventsQueryDto,
    {
      userId: "0c5f5d1e-62a3-4c53-8f4d-6d7e3a1b9c20",
      action: "auth.login",
      outcome: "denied",
      from: "2026-10-01T00:00:00.000Z",
      page: "2",
    },
    "query"
  );
  assert.equal(ok.page, 2);
  await rejects(adminDto.EventsQueryDto, { userId: "nao-e-uuid" }, "Identificador inválido.", "query");
  await rejects(adminDto.EventsQueryDto, { outcome: "talvez" }, "Resultado inválido.", "query");
  await rejects(adminDto.EventsQueryDto, { from: "ontem" }, "Data inválida.", "query");
  await rejects(adminDto.EventsQueryDto, { role: "master" }, "Campos inválidos.", "query");
});
