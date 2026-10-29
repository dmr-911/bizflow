import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { closePool, createPool, getDb, getTenantDb, migrate, setPool, type Db, type TenantDb } from "@/lib/db";

/**
 * Tests run against a real Postgres. Each test file gets its own schema, created
 * and migrated before its tests and dropped afterwards, so files can run in parallel
 * and nothing outside that schema is touched.
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
    await migrate(pool);
    setPool(pool);
  });

  beforeEach(async () => {
    const db = await getDb();
    // Truncating accounts cascades to every table that references it.
    await db.run("TRUNCATE accounts, webhook_events RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await closePool();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
}

/** A bare account to hang business records on. */
export async function newTenant(name = "Test Business"): Promise<TenantDb> {
  const db: Db = await getDb();
  const { id } = (await db.get<{ id: number }>(
    "INSERT INTO accounts (business_name, created_at) VALUES ($1, $2) RETURNING id",
    name,
    new Date().toISOString(),
  ))!;
  return getTenantDb(id);
}
