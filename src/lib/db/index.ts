import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
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

export function databasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "bizflow.db");
}

// One connection per server process; survives dev hot reloads.
const globalForDb = globalThis as unknown as { __bizflowDb?: DB };

export function getDb(): DB {
  if (!globalForDb.__bizflowDb) globalForDb.__bizflowDb = openDatabase(databasePath());
  return globalForDb.__bizflowDb;
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
