import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import main from "../dist/main.js";
import database from "../dist/common/database/database.service.js";
import deposits from "../dist/wallet/deposits.service.js";
import security from "../dist/common/security/crypto.js";
import mail from "../dist/auth/mail/mail.provider.js";
import pix from "../dist/banking/pix-directory.provider.js";

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
    await t.test("depósito do operador é idempotente", async () => {
      const ref = `deposit-${suffix}`;
      const one = await wallet.deposit(a.email, 10000, ref, ctx);
      const two = await wallet.deposit(a.email, 10000, ref, ctx);
      assert.equal(one.id, two.id);
      assert.equal(await balance(a), 10000);
      await assert.rejects(() => wallet.deposit(a.email, 10001, ref, ctx));
    });
    await t.test(
      "o usuário adiciona saldo à própria carteira, com limite e mensagem",
      async () => {
        const d = await account("saldo-inicial");
        const add = (amount, key, who = d) =>
          call("/deposits", "POST", { amount }, who.cookie, key);
        assert.equal(await balance(d), 0);
        const key = randomUUID();
        const first = await add(5000, key);
        assert.equal(first.status, 201);
        assert.equal(first.data.kind, "deposit");
        assert.equal(first.data.message, "Saldo adicionado à sua carteira.");
        assert.equal(await balance(d), 5000);
        // Repetir o pedido (mesma chave e dados) devolve o original e não credita de novo.
        const again = await add(5000, key);
        assert.equal(again.status, 201);
        assert.equal(again.data.id, first.data.id);
        assert.equal(await balance(d), 5000);
        // A mesma chave com outro valor é conflito; saldo intacto.
        assert.equal((await add(6000, key)).status, 409);
        assert.equal(await balance(d), 5000);
        // Teto por operação, valores inválidos e ausência de chave.
        const tooMuch = await add(1000001, randomUUID());
        assert.equal(tooMuch.status, 400);
        assert.equal(tooMuch.data.message, "O valor máximo por adição é R$ 10.000,00.");
        for (const amount of [0, -1, 1.5])
          assert.equal((await add(amount, randomUUID())).status, 400);
        assert.equal(
          (await call("/deposits", "POST", { amount: 100 }, d.cookie)).status,
          400
        );
        // Não há como escolher a carteira de destino: o campo é recusado.
        assert.equal(
          (
            await call(
              "/deposits",
              "POST",
              { amount: 100, userId: a.id },
              d.cookie,
              randomUUID()
            )
          ).status,
          400
        );
        assert.equal(await balance(d), 5000);
        // Sem sessão não adiciona saldo.
        assert.equal(
          (await call("/deposits", "POST", { amount: 100 }, "", randomUUID()))
            .status,
          401
        );
        // O valor entra no razão como depósito e a conciliação continua correta.
        const events = await owner.query(
          "SELECT action,actor_id,details->>'origin' AS origin FROM audit_events WHERE actor_id=$1 AND action='deposit.completed'",
          [d.id]
        );
        assert.equal(events.rowCount, 1);
        assert.equal(events.rows[0].origin, "self-service");
      }
    );
    await t.test(
      "notificações de transferência e devolução recebidas, lidas somem da lista",
      async () => {
        const n1 = await account("aviso-um"),
          n2 = await account("aviso-dois");
        await wallet.deposit(n1.email, 5000, `aviso-${suffix}`, ctx);
        const list = u => call("/notifications", "GET", undefined, u.cookie);
        const count = async u =>
          (await call("/notifications/count", "GET", undefined, u.cookie)).data
            .unread;
        assert.equal(await count(n2), 0);

        // Quem recebe é avisado; quem envia não.
        const sent = await transfer(n1, n2, 1000);
        assert.equal(sent.status, 201);
        assert.equal(await count(n2), 1);
        assert.equal(await count(n1), 0);
        const received = (await list(n2)).data;
        assert.equal(received.unread, 1);
        assert.equal(received.items[0].kind, "transfer_received");
        assert.equal(received.items[0].movementId, sent.data.id);
        assert.match(received.items[0].message, /enviou R\$ 10,00 para você\./);
        assert.equal((await list(n1)).data.items.length, 0);

        // Repetir a mesma transferência (mesma chave) não cria outro aviso.
        const key = randomUUID();
        await transfer(n1, n2, 100, key);
        await transfer(n1, n2, 100, key);
        assert.equal(await count(n2), 2);

        // Outra pessoa não consegue ler nem marcar o aviso alheio.
        const mine = received.items[0].id;
        assert.equal(
          (await call(`/notifications/${mine}/read`, "POST", {}, n1.cookie)).status,
          404
        );
        assert.equal(await count(n2), 2);

        // Marcar como lida: some da lista e o contador cai. Repetir não dá erro.
        const read = await call(`/notifications/${mine}/read`, "POST", {}, n2.cookie);
        assert.equal(read.status, 201);
        assert.equal(read.data.message, "Notificação marcada como lida.");
        assert.equal(await count(n2), 1);
        assert(!(await list(n2)).data.items.some(i => i.id === mine));
        assert.equal(
          (await call(`/notifications/${mine}/read`, "POST", {}, n2.cookie)).status,
          201
        );

        // Corpo extra e id inválido são recusados; sem sessão não lê.
        assert.equal(
          (await call(`/notifications/${mine}/read`, "POST", { x: 1 }, n2.cookie)).status,
          400
        );
        assert.equal(
          (await call("/notifications/nao-e-uuid/read", "POST", {}, n2.cookie)).status,
          400
        );
        assert.equal((await call("/notifications", "GET")).status, 401);

        // Devolução: quem enviou a transferência original é avisado.
        const refund = await call(
          `/transfers/${sent.data.id}/refund`,
          "POST",
          {},
          n2.cookie,
          randomUUID()
        );
        assert.equal(refund.status, 201);
        const back = (await list(n1)).data;
        assert.equal(back.unread, 1);
        assert.equal(back.items[0].kind, "refund_received");
        assert.match(back.items[0].message, /devolveu R\$ 10,00 da transferência que você enviou\./);

        // Marcar todas como lidas esvazia a lista de n2 (restava 1 aviso).
        const all = await call("/notifications/read-all", "POST", {}, n2.cookie);
        assert.equal(all.data.updated, 1);
        assert.equal((await list(n2)).data.items.length, 0);
        assert.equal(await count(n2), 0);
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
    await t.test(
      "perfil: trilha de acesso, preferências, dados bancários, chaves Pix e rosto na recuperação",
      async () => {
        const d = await account("Perfil");
        const other = await account("Outro");
        const login = async (password = pass, location) => {
          const l = await call("/auth/login", "POST", { email: d.email, password, location }, "", undefined, { "X-Forwarded-For": "192.0.2.202" });
          assert.equal(l.status, 201);
          return l;
        };

        // ---- Trilha de acesso ---------------------------------------------
        let trail = await call("/access", "GET", undefined, d.cookie);
        assert.equal(trail.status, 200);
        assert.equal(trail.data.items.length, 1);
        const first = trail.data.items[0];
        assert(first.active && first.current);
        assert.equal(first.location.status, "granted");
        assert.equal(first.location.latitude, -23.55);
        assert(first.ip && first.device);
        // O hash do token da sessão nunca sai pela API.
        assert(!JSON.stringify(trail.data).includes("token"));
        const map = await call("/access/map", "GET", undefined, d.cookie);
        assert.equal(map.data.items.length, 1);
        // Usuários só enxergam os próprios acessos.
        assert.equal((await call("/access", "GET", undefined, other.cookie)).data.items.length, 1);
        assert.notEqual(
          (await call("/access", "GET", undefined, other.cookie)).data.items[0].id,
          first.id
        );
        // Logout: o acesso é encerrado com o motivo e a duração.
        const second = await login();
        const verified = await call("/auth/verify", "POST", { code: d.recovery[2] }, second.cookie);
        assert.equal(verified.status, 201);
        assert.equal((await call("/auth/logout", "POST", {}, verified.cookie)).status, 201);
        trail = await call("/access", "GET", undefined, d.cookie);
        assert.equal(trail.data.items.length, 2);
        const closed = trail.data.items.find(i => !i.active);
        assert.equal(closed.endReason, "logout");
        assert(closed.endedAt && closed.durationSeconds >= 0);
        // A trilha só aceita o encerramento: nada é reescrito nem apagado.
        await assert.rejects(db.pool.query("UPDATE access_log SET ip='x' WHERE id=$1", [first.id]));
        await assert.rejects(db.pool.query("UPDATE access_log SET ended_at=now() WHERE id=$1", [closed.id]));
        await assert.rejects(db.pool.query("DELETE FROM access_log WHERE id=$1", [first.id]));

        // ---- Preferências -------------------------------------------------
        assert.deepEqual(
          (await call("/settings", "GET", undefined, d.cookie)).data,
          { biometricEnabled: false, geolocationEnabled: true, faceEnabled: false }
        );
        assert.equal((await call("/settings", "PATCH", { admin: true }, d.cookie)).status, 400);
        const saved = await call("/settings", "PATCH", { biometricEnabled: true, geolocationEnabled: false }, d.cookie);
        assert.equal(saved.status, 200);
        assert.equal(saved.data.biometricEnabled, true);
        // Com a geolocalização desligada, o servidor descarta a localização enviada.
        const noGeo = await login(pass, {
          status: "granted", latitude: 10, longitude: 10, accuracy: 5, capturedAt: new Date().toISOString(),
        });
        const noGeoVerified = await call("/auth/verify", "POST", { code: d.recovery[3] }, noGeo.cookie);
        assert.equal(noGeoVerified.status, 201);
        const latest = (await call("/access", "GET", undefined, noGeoVerified.cookie)).data.items[0];
        assert.equal(latest.location.status, "disabled");
        assert.equal(latest.location.latitude, undefined);
        d.cookie = noGeoVerified.cookie;
        // O master não usa estas rotas.
        assert.equal((await call("/settings", "GET", undefined, master.cookie)).status, 403);

        // ---- Dados bancários e chaves Pix ----------------------------------
        // CPF válido e novo a cada execução (a chave Pix é única no banco inteiro).
        const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
        const digit = (list, len) => {
          const sum = list.reduce((acc, n, i) => acc + n * (len + 1 - i), 0);
          const rest = (sum * 10) % 11;
          return rest === 10 ? 0 : rest;
        };
        base.push(digit(base, 9));
        base.push(digit(base, 10));
        const cpf = base.join("");
        const accountBody = {
          bankCode: "260", agency: "0001", accountNumber: `${Math.floor(100000 + Math.random() * 899999)}-1`,
          accountType: "checking", holderDocument: cpf,
        };
        assert.equal((await call("/banking/accounts", "POST", { ...accountBody, bankCode: "999" }, d.cookie)).status, 400);
        assert.equal((await call("/banking/accounts", "POST", { ...accountBody, holderDocument: "111.111.111-11" }, d.cookie)).status, 400);
        const created = await call("/banking/accounts", "POST", accountBody, d.cookie);
        assert.equal(created.status, 201);
        // A mesma conta não pode ser cadastrada por outro usuário.
        assert.equal((await call("/banking/accounts", "POST", accountBody, other.cookie)).status, 409);
        // Mais de um banco por usuário.
        const second2 = await call("/banking/accounts", "POST", { ...accountBody, bankCode: "341", agency: "1234", accountNumber: `${Math.floor(100000 + Math.random() * 899999)}-6` }, d.cookie);
        assert.equal(second2.status, 201);
        const keysPath = `/banking/accounts/${created.data.id}/pix-keys`;
        const cpfKey = await call(keysPath, "POST", { type: "cpf", value: cpf }, d.cookie);
        assert.equal(cpfKey.status, 201);
        assert.equal(cpfKey.data.status, "approved");
        // Chave única: nem na mesma conta, nem em outro banco do mesmo usuário, nem em outro usuário.
        assert.equal((await call(keysPath, "POST", { type: "cpf", value: cpf }, d.cookie)).status, 409);
        assert.equal((await call(`/banking/accounts/${second2.data.id}/pix-keys`, "POST", { type: "cpf", value: cpf }, d.cookie)).status, 409);
        // CPF de terceiros é recusado.
        assert.equal((await call(keysPath, "POST", { type: "cpf", value: "111.444.777-35" }, d.cookie)).status, 400);
        // E-mail exige prova de posse.
        const codes = [];
        app.get(pix.PIX_DIRECTORY).sendOwnershipCode = async (_t, _v, code) => codes.push(code);
        const mailKey = await call(keysPath, "POST", { type: "email", value: `pix-${suffix}@example.test` }, d.cookie);
        assert.equal(mailKey.data.status, "pending");
        assert.equal(codes.length, 1);
        assert.equal((await call(`/banking/pix-keys/${mailKey.data.id}/confirm`, "POST", { code: codes[0] }, other.cookie)).status, 404);
        const stored = (await owner.query("SELECT proof_hash FROM pix_keys WHERE id=$1", [mailKey.data.id])).rows[0];
        assert.notEqual(stored.proof_hash, codes[0]);
        const wrong = codes[0] === "000000" ? "111111" : "000000";
        assert.equal((await call(`/banking/pix-keys/${mailKey.data.id}/confirm`, "POST", { code: wrong }, d.cookie)).status, 422);
        assert.equal((await call(`/banking/pix-keys/${mailKey.data.id}/confirm`, "POST", { code: codes[0] }, d.cookie)).status, 201);
        const listed = await call("/banking/accounts", "GET", undefined, d.cookie);
        assert.equal(listed.data.items.length, 2);
        const firstAccount = listed.data.items.find(i => i.id === created.data.id);
        assert.deepEqual(firstAccount.keys.map(k => k.status).sort(), ["approved", "approved"]);
        // Isolamento: o outro usuário não vê nada disso nem remove.
        assert.equal((await call("/banking/accounts", "GET", undefined, other.cookie)).data.items.length, 0);
        assert.equal((await call(`/banking/accounts/${created.data.id}`, "DELETE", undefined, other.cookie)).status, 404);
        // Editar a chave de e-mail: volta a pendente e exige novo código; o antigo valor fica livre.
        const oldMail = `pix-${suffix}@example.test`, newMail = `pix2-${suffix}@example.test`;
        const edit = body => call(`/banking/pix-keys/${mailKey.data.id}`, "PATCH", body, d.cookie);
        assert.equal((await edit({ value: oldMail })).status, 422);
        assert.equal((await edit({ value: "invalido" })).status, 400);
        assert.equal((await edit({ value: newMail, tipo: "cpf" })).status, 400);
        assert.equal((await call(`/banking/pix-keys/${mailKey.data.id}`, "PATCH", { value: newMail }, other.cookie)).status, 404);
        const edited = await edit({ value: newMail });
        assert.equal(edited.status, 200);
        assert.equal(edited.data.status, "pending");
        assert.equal(codes.length, 2);
        assert.equal((await call(`/banking/pix-keys/${mailKey.data.id}/confirm`, "POST", { code: codes[1] }, d.cookie)).status, 201);
        // A chave aleatória não se edita.
        const evpKey = await call(keysPath, "POST", { type: "evp" }, d.cookie);
        assert.equal((await call(`/banking/pix-keys/${evpKey.data.id}`, "PATCH", { value: "x" }, d.cookie)).status, 422);
        assert.equal((await call(`/banking/pix-keys/${evpKey.data.id}`, "DELETE", undefined, d.cookie)).status, 200);
        // Remover uma chave libera o valor para ser registrado de novo.
        assert.equal((await call(`/banking/pix-keys/${cpfKey.data.id}`, "DELETE", undefined, d.cookie)).status, 200);
        assert.equal((await call(keysPath, "POST", { type: "cpf", value: cpf }, d.cookie)).status, 201);
        // Chave aleatória é gerada pelo servidor.
        const evp = await call(keysPath, "POST", { type: "evp", value: "tentativa" }, d.cookie);
        assert.equal(evp.status, 201);

        // ---- Reconhecimento facial na recuperação de senha ----------------
        const vector = seed => Array.from({ length: 128 }, (_, i) => Math.sin(i + seed) / 4);
        const steps = ["right", "left", "down", "up", "smile"];
        const enrollPath = "/settings/face";
        assert.equal((await call(enrollPath, "POST", { password: "errada", descriptor: vector(0), liveness: steps }, d.cookie)).status, 401);
        assert.equal((await call(enrollPath, "POST", { password: pass, descriptor: vector(0).slice(0, 10), liveness: steps }, d.cookie)).status, 400);
        assert.equal((await call(enrollPath, "POST", { password: pass, descriptor: vector(0), liveness: steps }, d.cookie)).status, 201);
        assert.equal((await call("/settings", "GET", undefined, d.cookie)).data.faceEnabled, true);
        // O modelo fica cifrado no banco e nenhuma rota o devolve.
        const tpl = (await owner.query("SELECT template FROM face_templates WHERE user_id=$1", [d.id])).rows[0].template;
        assert(/^[0-9a-f]+\.[0-9a-f]{32}\.[0-9a-f]+$/.test(tpl) && !tpl.includes("[") && !tpl.includes("\""));
        assert(!JSON.stringify((await call("/settings", "GET", undefined, d.cookie)).data).includes(tpl));

        const sent = [];
        app.get(mail.MAIL_PROVIDER).sendPasswordReset = async (to, token) => sent.push({ to, token });
        const ip = { "X-Forwarded-For": "192.0.2.201" };
        await call("/auth/forgot-password", "POST", { email: d.email }, "", undefined, ip);
        const token = sent[0].token;
        const need = await call("/auth/reset-requirements", "POST", { token }, "", undefined, ip);
        assert.equal(need.data.faceRequired, true);
        const newPass = "Senha com rosto 789!";
        const reset = face =>
          call("/auth/reset-password", "POST", { token, password: newPass, ...(face ? { face } : {}) }, "", undefined, ip);
        // Link sozinho não basta; rosto diferente também não.
        assert.equal((await reset()).status, 403);
        assert.equal((await reset(vector(77))).status, 403);
        // A recusa não gastou o link: o rosto certo ainda o usa.
        assert.equal((await reset(vector(0).map(n => n + 0.004))).status, 201);
        assert.equal((await reset(vector(0))).status, 400);
        assert.equal((await call("/auth/login", "POST", { email: d.email, password: newPass }, "", undefined, ip)).status, 201);
        const denied = await owner.query("SELECT 1 FROM audit_events WHERE action='face.verify' AND outcome='denied' AND actor_id=$1", [d.id]);
        assert.equal(denied.rowCount, 1);
      }
    );
    await t.test("BI: totais, séries e sugestões batem com o razão do usuário", async () => {
      const x = await account("BiUm"), y = await account("BiDois");
      await wallet.deposit(x.email, 10000, `bi-${suffix}`, ctx);
      assert.equal((await transfer(x, y, 3000)).status, 201);
      const insights = (u, q = "") => call(`/insights${q}`, "GET", undefined, u.cookie);
      const mine = (await insights(x)).data;
      assert.equal(mine.period, 90);
      assert.equal(mine.summary.income, 10000);
      assert.equal(mine.summary.expense, 3000);
      assert.equal(mine.summary.net, 7000);
      assert.equal(mine.summary.movements, 2);
      assert.equal(mine.balance, 7000);
      assert.equal(mine.byKind.find(k => k.id === "transfer_out").total, 3000);
      assert.equal(mine.byKind.find(k => k.id === "deposit").count, 1);
      // A série soma o mesmo que o resumo e termina no saldo atual.
      assert.equal(mine.series.reduce((s, p) => s + p.income, 0), 10000);
      assert.equal(mine.series.reduce((s, p) => s + p.expense, 0), 3000);
      assert.equal(mine.series.at(-1).balance, 7000);
      assert.equal(mine.counterparts.length, 1);
      assert.equal(mine.counterparts[0].name, "BiDois");
      assert.equal(mine.counterparts[0].sent, 3000);
      assert(Array.isArray(mine.suggestions) && mine.suggestions.some(s => s.id === "positive-net"));
      // Cada usuário vê só o próprio razão.
      const theirs = (await insights(y)).data;
      assert.equal(theirs.summary.income, 3000);
      assert.equal(theirs.summary.expense, 0);
      assert.equal(theirs.counterparts[0].received, 3000);
      // Períodos válidos mudam o agrupamento; inválidos e o master são recusados.
      assert.equal((await insights(x, "?period=30")).data.bucket, "day");
      assert.equal((await insights(x, "?period=365")).data.bucket, "month");
      assert.equal((await insights(x, "?period=7")).status, 400);
      assert.equal((await insights(master)).status, 403);
      assert.equal((await call("/insights", "GET")).status, 401);
    });
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
