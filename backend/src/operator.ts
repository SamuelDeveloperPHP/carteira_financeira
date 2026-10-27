import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { AuditService } from "./common/audit/audit.service";
import { Database } from "./common/database/database.service";
import { AuditContext } from "./common/http/request.types";
import { hashPassword } from "./common/security/crypto";
import * as V from "./common/security/validation";
import { UsersRepository } from "./users/users.repository";
import { DepositsService } from "./wallet/deposits.service";

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const db = app.get(Database),
    audit = app.get(AuditService),
    users = app.get(UsersRepository);
  const ctx: AuditContext = {
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
      const b = V.object(JSON.parse(input), ["name", "email", "password"]);
      const name = V.text(b.name, 2, 100),
        email = V.email(b.email),
        passwordHash = await hashPassword(V.password(b.password));
      await db.transaction(async tx => {
        const existing = await users.findByEmail(email, tx);
        if (existing) {
          if (existing.role !== "master")
            throw new Error(
              "An existing common user cannot be promoted by provisioning"
            );
          return;
        }
        const id = randomUUID();
        await users.insert(tx, { id, name, email, passwordHash, role: "master" });
        await audit.record("admin.provisioned", null, id, ctx, {}, "success", null, tx);
      });
      console.log(
        "Master provisionado. Configure o segundo fator no primeiro login."
      );
    } else if (command === "deposit") {
      const result = await app
        .get(DepositsService)
        .deposit(process.argv[3], Number(process.argv[4]), process.argv[5], ctx);
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
