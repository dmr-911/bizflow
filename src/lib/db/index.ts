import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { CONTROL_MIGRATIONS } from "./control-migrations";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;
type Migration = { id: number; name: string; sql: string };

/** Opens a business (tenant) database by default; pass CONTROL_MIGRATIONS for the accounts database. */
export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db, migrations);
  return db;
}

export function migrate(db: DB, migrations: Migration[] = MIGRATIONS): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}

/*
 * Storage layout: one control database for accounts, logins and billing, plus
 * one SQLite file per business. Every business query runs against that
 * business's own file, so one account can never read another account's data.
 */
export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
}

export const controlDatabasePath = () => path.join(dataDir(), "control.db");

export function tenantDatabasePath(accountId: number): string {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error("Invalid account id");
  return path.join(dataDir(), "tenants", `${accountId}.db`);
}

// Connections live for the server process and survive dev hot reloads.
const globalForDb = globalThis as unknown as { __bizflowControl?: DB; __bizflowTenants?: Map<number, DB> };
const MAX_OPEN_TENANTS = Number(process.env.MAX_OPEN_TENANT_DBS) || 200;

export function getControlDb(): DB {
  if (!globalForDb.__bizflowControl) globalForDb.__bizflowControl = openDatabase(controlDatabasePath(), CONTROL_MIGRATIONS);
  return globalForDb.__bizflowControl;
}

/** The business database for one account, opened (and migrated) on first use. */
export function getTenantDb(accountId: number): DB {
  const tenants = (globalForDb.__bizflowTenants ??= new Map());
  const open = tenants.get(accountId);
  if (open) {
    // Map keeps insertion order; re-inserting marks this one most recently used.
    tenants.delete(accountId);
    tenants.set(accountId, open);
    return open;
  }
  if (tenants.size >= MAX_OPEN_TENANTS) {
    const [oldestId, oldest] = tenants.entries().next().value as [number, DB];
    tenants.delete(oldestId);
    oldest.close();
  }
  const db = openDatabase(tenantDatabasePath(accountId));
  tenants.set(accountId, db);
  return db;
}

/** Close and forget a tenant connection, e.g. before deleting its file. */
export function closeTenantDb(accountId: number): void {
  const tenants = globalForDb.__bizflowTenants;
  tenants?.get(accountId)?.close();
  tenants?.delete(accountId);
}

let clockOverride: string | null = null;

export function nowIso(): string {
  return clockOverride ?? new Date().toISOString();
}

/** Run fn with timestamps pinned to `iso`. Used by demo data so history looks realistic. */
export function withClock<T>(iso: string, fn: () => T): T {
  const prev = clockOverride;
  clockOverride = iso;
  try {
    return fn();
  } finally {
    clockOverride = prev;
  }
}
