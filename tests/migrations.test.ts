import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool, migrate } from "@/lib/db";
import { TEST_DATABASE_URL } from "./helpers/db";

/** Each test gets an empty schema of its own. */
let schema: string;
let pool: pg.Pool;
const query = async <T extends pg.QueryResultRow>(text: string) => (await pool.query<T>(text)).rows;

beforeEach(async () => {
  schema = `mig_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
});

afterEach(async () => {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});

/** Tables, columns, constraints and indexes of the test schema, for comparing two databases. */
async function shape() {
  const tables = await query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity
     FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name NOT LIKE '%migrations' ORDER BY 1, 2`,
  );
  const constraints = await query(
    `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${schema}' AND conrelid::regclass::text NOT LIKE '%migrations' ORDER BY 1`,
  );
  const indexes = await query(
    `SELECT indexname, replace(indexdef, '${schema}.', '') AS def FROM pg_indexes
     WHERE schemaname = '${schema}' AND tablename NOT LIKE '%migrations' ORDER BY 1`,
  );
  return { tables, constraints, indexes };
}

describe("migrations", () => {
  it("creates exactly the schema BizFlow 2.1 created, so either kind of database behaves the same", async () => {
    await migrate(pool, { migrationsSchema: schema });
    const fresh = await shape();
    await pool.query(`DROP SCHEMA ${schema} CASCADE; CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync(path.join(__dirname, "fixtures", "legacy-schema.sql"), "utf8"));
    expect(await shape()).toEqual(fresh);
    expect(fresh.tables.length).toBeGreaterThan(100);
  });

  it("adopts a database created by the 2.1 runner without re-running the first migration", async () => {
    await pool.query(fs.readFileSync(path.join(__dirname, "fixtures", "legacy-schema.sql"), "utf8"));
    await pool.query(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    await pool.query(`INSERT INTO schema_migrations VALUES (1, 'accounts, billing and business records', '2026-10-30T00:00:00Z')`);
    await pool.query(`INSERT INTO accounts (business_name, created_at) VALUES ('Kept', '2026-10-30T00:00:00Z')`);

    expect(await migrate(pool, { migrationsSchema: schema })).toBe(0);
    expect(await query(`SELECT business_name FROM accounts`)).toEqual([{ business_name: "Kept" }]);
    expect(await query(`SELECT to_regclass('schema_migrations') AS t`)).toEqual([{ t: null }]);
    expect(await query(`SELECT count(*)::int AS n FROM __drizzle_migrations`)).toEqual([{ n: 1 }]);
    expect(await migrate(pool, { migrationsSchema: schema })).toBe(0);
  });

  it("lets concurrent cold starts migrate a fresh database once", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => migrate(pool, { migrationsSchema: schema })));
    expect(results.sort()).toEqual([0, 0, 0, 1]);
  });
});
