import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./main";
import { Database } from "./db";
import { Audit } from "./audit";
import { Wallet } from "./wallet";
import * as S from "./security";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const db = app.get(Database),
    audit = app.get(Audit);
  const ctx = {
    correlationId: randomUUID(),
    ip: "operator-cli",
    device: "controlled-local-operator",
    location: { status: "unavailable" },
  };
  try {
    const command = process.argv[2];
    if (command === "master") {
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const b = S.object(JSON.parse(input), ["name", "email", "password"]);
      const name = S.text(b.name, 2, 100),
        email = S.email(b.email),
        hash = await S.hashPassword(S.password(b.password));
      await db.transaction(async c => {
        const existing = (
          await c.query("SELECT id,role FROM users WHERE email=$1", [email])
        ).rows[0];
        if (existing) {
          if (existing.role !== "master")
            throw new Error(
              "An existing common user cannot be promoted by provisioning"
            );
          return;
        }
        const id = randomUUID();
        await c.query(
          "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'master')",
          [id, name, email, hash]
        );
        await audit.record(
          "admin.provisioned",
          null,
          id,
          ctx,
          {},
          "success",
          null,
          c
        );
      });
      console.log(
        "Master provisionado. Configure o segundo fator no primeiro login."
      );
    } else if (command === "deposit") {
      const result = await app
        .get(Wallet)
        .deposit(
          process.argv[3],
          Number(process.argv[4]),
          process.argv[5],
          ctx
        );
      console.log(
        JSON.stringify({
          id: result.id,
          amount: result.amount,
          simulated: true,
        })
      );
    } else
      throw new Error(
        "Use: master (JSON via stdin) | deposit <email> <centavos> <referencia-unica>"
      );
  } catch (e: any) {
    await audit.record(
      "operator.failed",
      null,
      null,
      ctx,
      {},
      "failure",
      "operator_command_failed"
    );
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
run().catch(() => {
  console.error("Operator initialization failed");
  process.exitCode = 1;
});
