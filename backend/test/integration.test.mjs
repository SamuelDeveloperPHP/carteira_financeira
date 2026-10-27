import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import main from "../dist/main.js";
import database from "../dist/common/database/database.service.js";
import deposits from "../dist/wallet/deposits.service.js";
import security from "../dist/common/security/crypto.js";
import mail from "../dist/auth/mail/mail.provider.js";

test("integração PostgreSQL: segurança, movimentações e auditoria", async t => {
  const ownerUrl = process.env.DATABASE_URL;
  assert(
    new URL(ownerUrl).pathname.endsWith("_test"),
    "Use apenas banco separado terminado em _test"
  );
  const owner = new Pool({ connectionString: ownerUrl });
  // This pool is restricted to the disposable *_test database asserted above.
  await owner.query("DELETE FROM rate_limits");
  const appUrl = new URL(ownerUrl);
  appUrl.username = "wallet_app";
  appUrl.password = process.env.APP_DB_PASSWORD;
  process.env.DATABASE_URL = appUrl.toString();
  const app = await main.createApp();
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const db = app.get(database.Database),
    wallet = app.get(deposits.DepositsService);
  const suffix = randomUUID().slice(0, 8);
  const pass = "Senha de teste 123!";
  let serial = 10;
  const ctx = {
    correlationId: randomUUID(),
    ip: "test-operator",
    device: "integration",
    location: { status: "unavailable" },
  };
  async function call(
    path,
    method = "GET",
    body,
    cookie = "",
    key,
    extra = {}
  ) {
    const r = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: "http://localhost:3080",
        "X-Wallet-Request": "1",
        "Content-Type": "application/json",
        "X-Forwarded-For": "192.0.2.10",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      headers: r.headers,
    };
  }
  async function account(name, role = "user") {
    const email = `${name}-${suffix}@example.test`.toLowerCase(),
      ip = `192.0.2.${serial++}`;
    let id;
    if (role === "master") {
      id = randomUUID();
      await owner.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'master')",
        [id, name, email, await security.hashPassword(pass)]
      );
    } else
      assert.equal(
        (
          await call(
            "/auth/register",
            "POST",
            { name, email, password: pass },
            "",
            undefined,
            { "X-Forwarded-For": ip }
          )
        ).status,
        201
      );
    const login = await call(
      "/auth/login",
      "POST",
      {
        email,
        password: pass,
        location: {
          status: "granted",
          latitude: -23.55,
          longitude: -46.63,
          accuracy: 25,
          capturedAt: new Date().toISOString(),
        },
      },
      "",
      undefined,
      { "X-Forwarded-For": ip }
    );
    assert.equal(login.status, 201);
    const setup = await call("/auth/setup", "GET", undefined, login.cookie);
    assert.equal(setup.status, 200);
    const usedCode = security.totp(setup.data.secret).generate();
    const verified = await call(
      "/auth/verify",
      "POST",
      { code: usedCode },
      login.cookie
    );
    assert.equal(verified.status, 201);
    return {
      email,
      id: verified.data.user.id,
      cookie: verified.cookie,
      recovery: verified.data.recoveryCodes,
      secret: setup.data.secret,
      usedCode,
      setupCookie: login.cookie,
    };
  }
  const transfer = (a, b, amount, key = randomUUID()) =>
    call(
      "/transfers",
      "POST",
      { recipientEmail: b.email, amount },
      a.cookie,
      key
    );
  const balance = async a =>
    (await call("/wallet", "GET", undefined, a.cookie)).data.balance;
  let a, b, c, master, movement;
  try {
    await t.test("cadastro seguro, saldo zero e 2FA obrigatório", async () => {
      assert.equal(
        (
          await call("/auth/register", "POST", {
            name: "Invasor",
            email: `bad-${suffix}@example.test`,
            password: pass,
            role: "master",
          })
        ).status,
        400
      );
      a = await account("Alice");
      b = await account("Bruno");
      c = await account("Carla");
      master = await account("Auditor", "master");
      assert.equal(await balance(a), 0);
      assert.equal(
        (await call("/wallet", "GET", undefined, a.setupCookie)).status,
        401
      );
      const login = await call("/auth/login", "POST", {
        email: a.email,
        password: pass,
        location: { status: "denied" },
      });
      assert.equal(
        (await call("/wallet", "GET", undefined, login.cookie)).status,
        403
      );
      assert.equal(
        (await call("/auth/verify", "POST", { code: a.usedCode }, login.cookie))
          .status,
        401
      );
      const verified = await call(
        "/auth/verify",
        "POST",
        { code: a.recovery[0] },
        login.cookie
      );
      assert.equal(verified.status, 201);
      a.cookie = verified.cookie;
      const next = await call("/auth/login", "POST", {
        email: a.email,
        password: pass,
      });
      assert.equal(
        (
          await call(
            "/auth/verify",
            "POST",
            { code: a.recovery[0] },
            next.cookie
          )
        ).status,
        401
      );
      assert.equal(
        (
          await call(
            "/auth/verify",
            "POST",
            { code: a.recovery[1] },
            next.cookie
          )
        ).status,
        201
      );
      assert(verified.headers.get("set-cookie").includes("HttpOnly"));
      assert(verified.headers.get("set-cookie").includes("SameSite=Strict"));
    });
    await t.test(
      "depósito controlado, idempotente e sem endpoint público",
      async () => {
        const ref = `deposit-${suffix}`;
        const one = await wallet.deposit(a.email, 10000, ref, ctx);
        const two = await wallet.deposit(a.email, 10000, ref, ctx);
        assert.equal(one.id, two.id);
        assert.equal(await balance(a), 10000);
        await assert.rejects(() => wallet.deposit(a.email, 10001, ref, ctx));
        assert.equal(
          (await call("/deposits", "POST", { amount: 10000 }, a.cookie)).status,
          404
        );
      }
    );
    await t.test("validação e isolamento das contas", async () => {
      for (const amount of [0, -1, 1.5, 1000000000001])
        assert.equal((await transfer(a, b, amount)).status, 400);
      assert.equal((await transfer(a, a, 100)).status, 400);
      assert.equal(
        (
          await call(
            `/wallet/statement?userId=${b.id}`,
            "GET",
            undefined,
            a.cookie
          )
        ).status,
        400
      );
      assert.equal(
        (await call("/admin/users", "GET", undefined, a.cookie)).status,
        403
      );
      assert.equal((await transfer(master, a, 100)).status, 403);
      assert.equal(
        (
          await call(
            "/transfers",
            "POST",
            { recipientEmail: b.email, amount: 100 },
            a.cookie,
            randomUUID(),
            { Origin: "https://invalid.example" }
          )
        ).status,
        403
      );
    });
    await t.test(
      "transferência atômica, repetição concorrente e conflito de chave",
      async () => {
        const key = randomUUID();
        const results = await Promise.all(
          Array.from({ length: 5 }, () => transfer(a, b, 2000, key))
        );
        for (const result of results) assert.equal(result.status, 201);
        assert.equal(new Set(results.map(r => r.data.id)).size, 1);
        movement = results[0].data;
        assert.equal(await balance(a), 8000);
        assert.equal(await balance(b), 2000);
        assert.equal((await transfer(a, b, 3000, key)).status, 409);
        const entries = (
          await owner.query("SELECT delta FROM entries WHERE movement_id=$1", [
            movement.id,
          ])
        ).rows;
        assert.equal(entries.length, 2);
        assert.equal(
          entries.reduce((s, r) => s + Number(r.delta), 0),
          0
        );
      }
    );
    await t.test(
      "devolução exclusiva do destinatário, integral e única",
      async () => {
        assert.equal(
          (
            await call(
              `/transfers/${movement.id}/refund`,
              "POST",
              {},
              a.cookie,
              randomUUID()
            )
          ).status,
          403
        );
        const key = randomUUID();
        const results = await Promise.all(
          [1, 2, 3].map(() =>
            call(`/transfers/${movement.id}/refund`, "POST", {}, b.cookie, key)
          )
        );
        results.forEach(r => assert.equal(r.status, 201));
        assert.equal(new Set(results.map(r => r.data.id)).size, 1);
        assert.equal(await balance(a), 10000);
        assert.equal(await balance(b), 0);
        assert.equal(
          (
            await call(
              `/transfers/${movement.id}/refund`,
              "POST",
              {},
              b.cookie,
              randomUUID()
            )
          ).status,
          409
        );
      }
    );
    await t.test(
      "saldo insuficiente para devolver preserva histórico e saldos",
      async () => {
        const original = await transfer(a, b, 2000);
        assert.equal((await transfer(b, c, 2000)).status, 201);
        assert.equal(
          (
            await call(
              `/transfers/${original.data.id}/refund`,
              "POST",
              {},
              b.cookie,
              randomUUID()
            )
          ).status,
          400
        );
        assert.equal(await balance(b), 0);
        assert.equal(await balance(c), 2000);
      }
    );
    await t.test("saídas concorrentes não gastam o mesmo saldo", async () => {
      const result = await Promise.all([
        transfer(a, b, 6000),
        transfer(a, c, 6000),
      ]);
      assert.deepEqual(result.map(r => r.status).sort(), [201, 400]);
      assert.equal(await balance(a), 2000);
    });
    await t.test(
      "25 saídas simultâneas gastam o saldo exatamente uma vez",
      async () => {
        const payer = await account("Eva"),
          payee = await account("Fabio");
        await wallet.deposit(payer.email, 10000, `burst-${suffix}`, ctx);
        const results = await Promise.all(
          Array.from({ length: 25 }, () => transfer(payer, payee, 1000))
        );
        const statuses = results.map(r => r.status);
        assert.equal(statuses.filter(s => s === 201).length, 10);
        assert.equal(statuses.filter(s => s === 400).length, 15);
        assert.equal(await balance(payer), 0);
        assert.equal(await balance(payee), 10000);
        const { rows } = await owner.query(
          "SELECT count(*)::int AS n,coalesce(sum(delta),0)::int AS total FROM entries WHERE user_id IN ($1,$2)",
          [payer.id, payee.id]
        );
        // 1 depósito + 10 débitos + 10 créditos; soma = o depósito.
        assert.deepEqual(rows[0], { n: 21, total: 10000 });
      }
    );
    await t.test(
      "no máximo 5 sessões completas por usuário; as mais antigas são revogadas",
      async () => {
        const g = await account("Gil");
        const ip = { "X-Forwarded-For": "192.0.2.210" };
        const cookies = [g.cookie];
        for (const code of g.recovery.slice(0, 6)) {
          const login = await call(
            "/auth/login",
            "POST",
            { email: g.email, password: pass },
            "",
            undefined,
            ip
          );
          const verified = await call(
            "/auth/verify",
            "POST",
            { code },
            login.cookie
          );
          assert.equal(verified.status, 201);
          cookies.push(verified.cookie);
        }
        assert.equal(cookies.length, 7);
        for (const old of cookies.slice(0, 2))
          assert.equal((await call("/wallet", "GET", undefined, old)).status, 401);
        for (const live of cookies.slice(2))
          assert.equal((await call("/wallet", "GET", undefined, live)).status, 200);
      }
    );
    await t.test(
      "ruído anônimo tem orçamento por IP e consultas de saldo não poluem a trilha",
      async () => {
        // IP único por execução: o banco de teste conserva a trilha das anteriores.
        const ip = `2001:db8::${suffix.slice(0, 4)}:${suffix.slice(4)}`;
        for (let i = 0; i < 110; i++)
          await call("/wallet", "GET", undefined, "", undefined, {
            "X-Forwarded-For": ip,
          });
        assert.equal(
          (
            await owner.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE ip=$1",
              [ip]
            )
          ).rows[0].n,
          100
        );
        const events = async () =>
          (await owner.query("SELECT count(*)::int AS n FROM audit_events"))
            .rows[0].n;
        const before = await events();
        await balance(a);
        assert.equal(await events(), before);
      }
    );
    await t.test(
      "falha no crédito reverte débito, lançamento e evidência de sucesso",
      async () => {
        const before = [await balance(a), await balance(b)];
        const count = (await owner.query("SELECT count(*) FROM movements"))
          .rows[0].count;
        await owner.query(
          `CREATE FUNCTION test_credit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.delta>0 THEN RAISE EXCEPTION 'test injected failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON entries FOR EACH ROW EXECUTE FUNCTION test_credit_failure()`
        );
        try {
          assert.equal((await transfer(a, b, 100)).status, 500);
        } finally {
          await owner.query(
            "DROP TRIGGER test_fail ON entries; DROP FUNCTION test_credit_failure()"
          );
        }
        assert.deepEqual([await balance(a), await balance(b)], before);
        assert.equal(
          (await owner.query("SELECT count(*) FROM movements")).rows[0].count,
          count
        );
        assert(
          (
            await owner.query(
              "SELECT 1 FROM audit_events WHERE outcome='failure' AND action='POST /api/transfers'"
            )
          ).rowCount > 0
        );
      }
    );
    await t.test(
      "privilégios impedem alteração de auditoria e lançamentos",
      async () => {
        await assert.rejects(
          () => db.pool.query("UPDATE audit_events SET reason='alterado'"),
          e => e.code === "42501"
        );
        await assert.rejects(
          () => db.pool.query("DELETE FROM entries"),
          e => e.code === "42501"
        );
        await assert.rejects(
          () => db.pool.query("UPDATE movements SET amount=1"),
          e => e.code === "42501"
        );
        await assert.rejects(() =>
          owner.query("UPDATE audit_events SET reason='alterado'")
        );
      }
    );
    await t.test(
      "master consulta, filtra, rastreia e tem suas consultas auditadas",
      async () => {
        const events = await call(
          `/admin/events?userId=${a.id}&action=auth.login`,
          "GET",
          undefined,
          master.cookie
        );
        assert.equal(events.status, 200);
        assert(events.data.items.length > 0);
        assert(events.data.items.some(e => e.location.status === "granted"));
        assert(events.data.items.some(e => e.location.status === "denied"));
        const trace = await call(
          `/admin/movements/${movement.id}`,
          "GET",
          undefined,
          master.cookie
        );
        assert.equal(trace.status, 200);
        assert.equal(trace.data.entries.length, 2);
        assert.equal(
          (
            await call(
              `/admin/users/${a.id}/statement`,
              "GET",
              undefined,
              master.cookie
            )
          ).status,
          200
        );
        const metrics = await call(
          "/admin/metrics",
          "GET",
          undefined,
          master.cookie
        );
        assert.equal(metrics.data.reconciliation.balanced, true);
        assert(metrics.data.alerts.length > 0);
        assert(
          (
            await owner.query(
              "SELECT 1 FROM audit_events WHERE actor_id=$1 AND action='admin.events.view'",
              [master.id]
            )
          ).rowCount > 0
        );
        const raw = JSON.stringify(
          (await owner.query("SELECT * FROM audit_events")).rows
        );
        assert(!raw.includes(pass));
        assert(!raw.includes(a.secret));
        assert(!raw.includes(a.recovery[0]));
      }
    );
    await t.test(
      "falhas de login ficam relacionadas à conta e tentativas são limitadas",
      async () => {
        for (let i = 0; i < 11; i++) {
          const r = await call("/auth/login", "POST", {
            email: c.email,
            password: "senha-incorreta",
          });
          if (i === 10) assert.equal(r.status, 429);
        }
        assert(
          (
            await owner.query(
              "SELECT 1 FROM audit_events WHERE resource=$1 AND outcome='denied' AND action='POST /api/auth/login'",
              [c.id]
            )
          ).rowCount > 0
        );
      }
    );
    await t.test(
      "troca de autenticador revoga sessões e exige nova configuração",
      async () => {
        const rotated = await call(
          "/auth/rotate",
          "POST",
          { password: pass, code: b.recovery[0] },
          b.cookie
        );
        assert.equal(rotated.status, 201);
        assert.equal(rotated.data.stage, "setup");
        assert.equal(
          (await call("/wallet", "GET", undefined, b.cookie)).status,
          401
        );
        assert.equal(
          (await call("/wallet", "GET", undefined, rotated.cookie)).status,
          403
        );
        assert.equal(
          (
            await owner.query("SELECT * FROM recovery_codes WHERE user_id=$1", [
              b.id,
            ])
          ).rowCount,
          0
        );
        const setup = await call(
          "/auth/setup",
          "GET",
          undefined,
          rotated.cookie
        );
        assert.notEqual(setup.data.secret, b.secret);
      }
    );
    await t.test(
      "recuperação de senha: link de 7 minutos, uso único, sem contornar o 2FA",
      async () => {
        const d = await account("Diana");
        const ip = { "X-Forwarded-For": "192.0.2.200" };
        const sent = [];
        const mailer = app.get(mail.MAIL_PROVIDER);
        mailer.sendPasswordReset = async (to, token) => sent.push({ to, token });
        const ask = email =>
          call("/auth/forgot-password", "POST", { email }, "", undefined, ip);
        const reset = (token, password) =>
          call(
            "/auth/reset-password",
            "POST",
            { token, password },
            "",
            undefined,
            ip
          );
        const newPass = "Outra senha forte 456!";
        // Mesma resposta para conta existente e inexistente; nada é enviado a quem não existe.
        const unknown = await ask(`ninguem-${suffix}@example.test`);
        const known = await ask(d.email);
        assert.equal(unknown.status, 201);
        assert.equal(known.status, 201);
        assert.equal(unknown.data.message, known.data.message);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, d.email);
        const first = sent[0].token;
        // Só o hash fica no banco e a validade é de exatamente 7 minutos.
        const stored = (
          await owner.query(
            "SELECT token_hash,extract(epoch from expires_at-created_at)::int AS ttl FROM password_resets WHERE user_id=$1",
            [d.id]
          )
        ).rows;
        assert.equal(stored.length, 1);
        assert.equal(stored[0].ttl, 420);
        assert.notEqual(stored[0].token_hash, first);
        // Entradas inválidas.
        assert.equal((await reset("0".repeat(64), newPass)).status, 400);
        assert.equal((await reset("curto", newPass)).status, 400);
        assert.equal((await reset(first, "curta")).status, 400);
        // Redefinição válida encerra sessões e troca a senha.
        const done = await reset(first, newPass);
        assert.equal(done.status, 201);
        assert.equal(
          (await call("/wallet", "GET", undefined, d.cookie)).status,
          401
        );
        assert.equal((await reset(first, newPass)).status, 400);
        const old = await call("/auth/login", "POST", {
          email: d.email,
          password: pass,
        }, "", undefined, ip);
        assert.equal(old.status, 401);
        const fresh = await call("/auth/login", "POST", {
          email: d.email,
          password: newPass,
        }, "", undefined, ip);
        // O segundo fator continua obrigatório após redefinir a senha.
        assert.equal(fresh.data.stage, "challenge");
        assert.equal(
          (await call("/wallet", "GET", undefined, fresh.cookie)).status,
          403
        );
        // Link expirado é recusado; um novo pedido substitui o anterior.
        await ask(d.email);
        await ask(d.email);
        assert.equal(sent.length, 3);
        assert.equal(
          (
            await owner.query(
              "SELECT 1 FROM password_resets WHERE user_id=$1",
              [d.id]
            )
          ).rowCount,
          1
        );
        assert.equal((await reset(sent[1].token, newPass)).status, 400);
        await owner.query(
          "UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [d.id]
        );
        assert.equal((await reset(sent[2].token, newPass)).status, 400);
        // Nenhum token em claro na trilha de auditoria.
        const raw = JSON.stringify(
          (await owner.query("SELECT * FROM audit_events")).rows
        );
        for (const item of sent) assert(!raw.includes(item.token));
        assert(raw.includes("auth.recovery.requested"));
        assert(raw.includes("auth.password.reset"));
      }
    );
    await t.test("logout revoga a sessão no servidor", async () => {
      assert.equal(
        (await call("/auth/logout", "POST", {}, a.cookie)).status,
        201
      );
      assert.equal(
        (await call("/wallet", "GET", undefined, a.cookie)).status,
        401
      );
    });
  } finally {
    await app.close();
    await owner.end();
  }
});
