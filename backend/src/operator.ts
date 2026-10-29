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

/**
 * Comando LOCAL do operador (não é uma rota HTTP).
 *
 * Existe para ações que nenhum usuário pela web pode fazer:
 *   - `master`  : cria a conta do auditor (somente leitura);
 *   - `deposit` : credita saldo simulado em QUALQUER carteira e sem o teto que
 *                 vale para o usuário (que só adiciona à própria, via POST /deposits).
 *
 * Por que "criar master" fica fora da API? Se fosse um endpoint, um invasor que o
 * descobrisse ganharia privilégio. Aqui exige acesso ao servidor (docker exec), e
 * tudo é auditado com o autor "operator-cli".
 *
 * Reaproveita os mesmos serviços da API (createApplicationContext sobe o
 * contêiner de injeção do Nest sem abrir porta HTTP), então as regras de
 * validação, saldo e auditoria são exatamente as mesmas.
 */
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const db = app.get(Database),
    audit = app.get(AuditService),
    users = app.get(UsersRepository);

  // Contexto de auditoria fixo: deixa claro, nos eventos, que a ação veio do
  // operador local e não de um navegador.
  const ctx: AuditContext = {
    correlationId: randomUUID(),
    ip: "operator-cli",
    device: "controlled-local-operator",
    location: { status: "unavailable" },
  };
  try {
    const command = process.argv[2];
    if (command === "master") {
      // Os dados chegam por STDIN (JSON), e não por argumentos, para que a senha
      // não fique no histórico do shell nem na lista de processos.
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      // `object` recusa campos fora da lista; os demais validam formato e tamanho.
      const b = V.object(JSON.parse(input), ["name", "email", "password"]);
      const name = V.text(b.name, 2, 100),
        email = V.email(b.email),
        passwordHash = await hashPassword(V.password(b.password));
      await db.transaction(async tx => {
        const existing = await users.findByEmail(email, tx);
        if (existing) {
          // Idempotente para um master que já existe (rodar de novo não faz nada),
          // mas NUNCA promove um cliente comum a master: isso seria escalonamento
          // de privilégio por provisionamento.
          if (existing.role !== "master")
            throw new Error(
              "An existing common user cannot be promoted by provisioning"
            );
          return;
        }
        const id = randomUUID();
        await users.insert(tx, {
          id,
          name,
          email,
          passwordHash,
          role: "master",
        });
        await audit.record(
          "admin.provisioned",
          null,
          id,
          ctx,
          {},
          "success",
          null,
          tx
        );
      });
      console.log(
        "Master provisionado. Configure o segundo fator no primeiro login."
      );
    } else if (command === "deposit") {
      // Argumentos: <email> <centavos> <referencia-unica>. A referência é a chave
      // de idempotência: rodar o mesmo comando duas vezes credita uma só.
      const result = await app
        .get(DepositsService)
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
    // Falhas do operador também entram na trilha de auditoria. O motivo gravado é
    // genérico de propósito (o detalhe aparece só no terminal de quem executou).
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
    // Fecha o pool de conexões; sem isso o processo ficaria preso.
    await app.close();
  }
}
run().catch(() => {
  console.error("Operator initialization failed");
  process.exitCode = 1;
});
