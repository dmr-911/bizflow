import path from "node:path";
import type pg from "pg";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";

/*
 * Applies the SQL migrations that Drizzle Kit writes to /drizzle (`npm run db:generate`).
 *
 * It keeps Drizzle's own bookkeeping table (drizzle.__drizzle_migrations), so
 * `drizzle-kit migrate` and this runner agree on what has been applied. It adds two
 * things Drizzle's migrator lacks:
 *  - a transaction-scoped advisory lock, so concurrent serverless cold starts wait for
 *    each other instead of racing (works through Neon's pooler);
 *  - adoption of databases created by BizFlow 2.1's own runner (table schema_migrations),
 *    whose schema is identical to migration 0000.
 */

export interface MigrateOptions {
  /** Where the bookkeeping table lives. Default "drizzle", like Drizzle Kit. */
  migrationsSchema?: string;
  /** Default: <cwd>/drizzle. */
  migrationsFolder?: string;
}

const MIGRATION_LOCK = 2;
const TABLE = "__drizzle_migrations";

export function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Returns how many migrations were applied. */
export async function runMigrations(pool: pg.Pool, opts: MigrateOptions = {}): Promise<number> {
  const migrations: MigrationMeta[] = readMigrationFiles({ migrationsFolder: opts.migrationsFolder ?? migrationsFolder() });
  const schema = `"${(opts.migrationsSchema ?? "drizzle").replace(/"/g, '""')}"`;
  const table = `${schema}."${TABLE}"`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    let last = Number((await client.query(`SELECT max(created_at) AS last FROM ${table}`)).rows[0]?.last ?? 0);

    if (!last && migrations.length > 0 && (await adoptLegacy(client))) {
      const [first] = migrations;
      await client.query(`INSERT INTO ${table} (hash, created_at) VALUES ($1, $2)`, [first.hash, first.folderMillis]);
      last = first.folderMillis;
    }

    let count = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const stmt of m.sql) if (stmt.trim()) await client.query(stmt);
      await client.query(`INSERT INTO ${table} (hash, created_at) VALUES ($1, $2)`, [m.hash, m.folderMillis]);
      count++;
    }
    await client.query("COMMIT");
    return count;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** A database set up by the 2.1 runner already has migration 0000's tables. Drop its table and take it over. */
async function adoptLegacy(client: pg.PoolClient): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS found`);
  if (!rows[0].found) return false;
  const applied = (await client.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => Number(r.id));
  if (applied.join() !== "1") throw new Error(`Unexpected schema_migrations contents (${applied.join() || "empty"}); migrate by hand.`);
  await client.query("DROP TABLE schema_migrations");
  return true;
}
