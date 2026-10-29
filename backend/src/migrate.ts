import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Aplica as migrações SQL e prepara o usuário de banco usado pela API.
 *
 * Roda como comando separado (`npm run migrate`), com a conexão do DONO do
 * banco, antes de a API subir. A API em si conecta como `wallet_app`, que tem
 * poderes mínimos. Separar os dois é o que impede a aplicação de alterar o
 * esquema ou o histórico financeiro, mesmo que seja comprometida.
 *
 * Tudo acontece em UMA transação: se qualquer passo falhar, nada é aplicado.
 */
async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // Trava de aconselhamento: se dois containers tentarem migrar ao mesmo
    // tempo, o segundo espera o primeiro terminar, em vez de aplicar duas vezes.
    // É liberada sozinha no COMMIT/ROLLBACK (por isso "xact").
    await c.query("SELECT pg_advisory_xact_lock(9182701)");

    // Os arquivos têm prefixo numérico (001_, 002_...), então a ordem
    // alfabética é a ordem de aplicação.
    const files = readdirSync("migrations")
      .filter(f => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      // Em banco novo a tabela de controle ainda não existe (ela é criada pela
      // própria 001); to_regclass devolve NULL nesse caso, sem dar erro.
      const exists = await c.query(
        "SELECT to_regclass('public.schema_migrations') AS name"
      );
      const applied = exists.rows[0].name
        ? (
            await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
              file.replace(/\.sql$/, ""),
            ])
          ).rowCount
        : 0;
      // Idempotente: rodar o comando de novo só aplica o que ainda falta.
      if (!applied) await c.query(readFileSync(`migrations/${file}`, "utf8"));
    }

    // A senha do usuário da API vem do ambiente e é exigida forte: 32 bytes
    // aleatórios em hexadecimal. O formato rígido também garante que ela é
    // segura de interpolar no SQL abaixo (CREATE ROLE não aceita parâmetros).
    const password = process.env.APP_DB_PASSWORD;
    if (!password || !/^[a-f0-9]{64}$/.test(password))
      throw new Error("APP_DB_PASSWORD must be 32 random bytes in hex");
    const role = await c.query(
      "SELECT 1 FROM pg_roles WHERE rolname='wallet_app'"
    );
    if (!role.rowCount)
      await c.query(`CREATE ROLE wallet_app LOGIN PASSWORD '${password}'`);
    else await c.query(`ALTER ROLE wallet_app PASSWORD '${password}'`);

    // ---- Princípio do menor privilégio ------------------------------------
    await c.query("GRANT USAGE ON SCHEMA public TO wallet_app");
    // Tabelas "vivas" (mudam o tempo todo): leitura e escrita completas.
    // `notifications` entra aqui porque marcar como lida é um UPDATE.
    await c.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON users, wallets, sessions, recovery_codes, rate_limits, password_resets, notifications TO wallet_app"
    );
    // Tabelas de histórico: SOMENTE ler e inserir. Sem UPDATE/DELETE, a própria
    // aplicação não consegue reescrever movimentos, lançamentos ou auditoria
    // (os gatilhos da 001 são a segunda barreira).
    await c.query(
      "GRANT SELECT, INSERT ON movements, entries, idempotency, audit_events TO wallet_app"
    );
    // Perfil: cadastro do usuário, alterável pela API.
    await c.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings, face_templates, bank_accounts, pix_keys TO wallet_app"
    );
    // Trilha de acesso: ler, inserir e encerrar (UPDATE restrito pelo gatilho
    // da 004 ao preenchimento único de ended_at). Sem DELETE.
    await c.query("GRANT SELECT, INSERT, UPDATE ON access_log TO wallet_app");
    // Necessário para os ids sequenciais (bigserial) de entries e audit_events.
    await c.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wallet_app"
    );

    await c.query("COMMIT");
    console.log(
      JSON.stringify({
        event: "migration.completed",
        version: files[files.length - 1].replace(/\.sql$/, ""),
      })
    );
  } catch (e) {
    // Qualquer falha desfaz a migração inteira; o banco não fica meio aplicado.
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
// Código de saída diferente de zero faz o Docker Compose interromper a subida,
// em vez de iniciar a API sobre um esquema incompleto. Só a mensagem é exibida
// (sem stack) para não vazar detalhes.
migrate().catch(e => {
  console.error("Migration failed:", e.message);
  process.exitCode = 1;
});
