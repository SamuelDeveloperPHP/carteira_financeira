import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(9182701)");
    const files = readdirSync("migrations")
      .filter(f => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
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
      if (!applied)
        await c.query(readFileSync(`migrations/${file}`, "utf8"));
    }
    const password = process.env.APP_DB_PASSWORD;
    if (!password || !/^[a-f0-9]{64}$/.test(password))
      throw new Error("APP_DB_PASSWORD must be 32 random bytes in hex");
    const role = await c.query(
      "SELECT 1 FROM pg_roles WHERE rolname='wallet_app'"
    );
    if (!role.rowCount)
      await c.query(`CREATE ROLE wallet_app LOGIN PASSWORD '${password}'`);
    else await c.query(`ALTER ROLE wallet_app PASSWORD '${password}'`);
    await c.query("GRANT USAGE ON SCHEMA public TO wallet_app");
    await c.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON users, wallets, sessions, recovery_codes, rate_limits, password_resets TO wallet_app"
    );
    await c.query(
      "GRANT SELECT, INSERT ON movements, entries, idempotency, audit_events TO wallet_app"
    );
    await c.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wallet_app"
    );
    await c.query("COMMIT");
    console.log(
      JSON.stringify({ event: "migration.completed", version: files[files.length - 1].replace(/\.sql$/, ""),
      })
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
migrate().catch(e => {
  console.error("Migration failed:", e.message);
  process.exitCode = 1;
});
