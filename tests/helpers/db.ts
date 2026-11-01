import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { closePool, createPool, getDb, getTenantDb, migrate, pgError, setPool, type TenantDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";

/**
 * Tests run against a real Postgres. Each test file gets its own schema, created
 * and migrated (with the real migrations in /drizzle) before its tests and dropped
 * afterwards, so files can run in parallel and nothing outside that schema is touched.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5432/bizflow_test npm test
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5432/bizflow_test";

export function useTestDatabase() {
  const schema = `test_${crypto.randomBytes(6).toString("hex")}`;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
    // The migration bookkeeping table goes in the same schema, so it is dropped with it.
    await migrate(pool, { migrationsSchema: schema });
    setPool(pool, { migrationsSchema: schema });
  });

  beforeEach(async () => {
    const db = await getDb();
    // Truncating accounts cascades to every table that references it.
    await db.orm.execute(sql`TRUNCATE accounts, webhook_events RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await closePool();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
}

/** Postgres's own error message for a query that must fail (Drizzle wraps it). */
export async function pgFailure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const pg = pgError(e);
    if (pg) return pg.message;
    throw e;
  }
  throw new Error("Expected the query to fail");
}

/** A bare account to hang business records on. */
export async function newTenant(name = "Test Business"): Promise<TenantDb> {
  const db = await getDb();
  const [{ id }] = await db.orm.insert(accounts).values({ businessName: name, createdAt: new Date().toISOString() }).returning({ id: accounts.id });
  return getTenantDb(id);
}
