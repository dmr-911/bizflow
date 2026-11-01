/**
 * One-time copy of the SQLite storage (DATA_DIR/control.db plus one
 * DATA_DIR/tenants/<accountId>.db per business) into the Postgres database.
 *
 * - Runs in a single transaction: either everything is copied or nothing is.
 * - Keeps every id, so links, bookmarks and Stripe/bKash references stay valid.
 *   Business ids repeat across businesses; the (account_id, id) keys allow that.
 * - Refuses to run against a database that already has accounts.
 * - Checks the row counts per table and business before committing.
 *
 * The SQLite files are only read, never changed.
 */
import fs from "node:fs";
import path from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { count, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { syncSequences, type Db } from "../src/lib/db";
import * as schema from "../src/lib/db/schema";
import { insertJsonRows, tableColumns } from "../src/lib/services/data";

type Row = Record<string, unknown>;

const CONTROL_TABLES = {
  accounts: schema.accounts,
  users: schema.users,
  sessions: schema.sessions,
  password_resets: schema.passwordResets,
  subscriptions: schema.subscriptions,
  billing_payments: schema.billingPayments,
  webhook_events: schema.webhookEvents,
};
// Parents before children. documents.source_document_id is linked in a second pass.
const BUSINESS_TABLES = {
  settings: schema.settings,
  customers: schema.customers,
  documents: schema.documents,
  document_items: schema.documentItems,
  payments: schema.payments,
  follow_ups: schema.followUps,
  activities: schema.activities,
};
const CHUNK = 1000;

/** Values SQLite stores differently from the Postgres schema. */
function convert(table: string, row: Row): Row {
  switch (table) {
    case "subscriptions":
      return { ...row, cancel_at_period_end: !!row.cancel_at_period_end };
    case "users":
      return { ...row, email: String(row.email).trim().toLowerCase() };
    case "settings":
      return { ...row, value: JSON.parse(String(row.value)) };
    case "documents":
      return { ...row, source_document_id: null };
    default:
      return row;
  }
}

/** Bulk insert in chunks. Business rows get `accountId`. */
async function insertRows(db: Db, name: string, table: PgTable, rows: Row[], accountId?: number): Promise<void> {
  if (rows.length === 0) return;
  const target = tableColumns(table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => target.has(c) && (accountId === undefined || c !== "account_id"));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => convert(name, r));
    await insertJsonRows(db, name, cols, chunk, { accountId });
  }
}

export async function importSqlite(db: Db, dataDir: string, opts: { log?: (msg: string) => void } = {}): Promise<{ accounts: number; businesses: number }> {
  const log = opts.log ?? (() => {});
  const controlFile = path.join(dataDir, "control.db");
  if (!fs.existsSync(controlFile)) throw new Error(`No control.db in ${dataDir}. Pass the folder that held the SQLite files (DATA_DIR).`);
  const { default: Database } = await import("better-sqlite3");
  const open = (file: string): BetterSqlite3.Database => new Database(file, { readonly: true, fileMustExist: true });
  const read = (sqlite: BetterSqlite3.Database, table: string): Row[] => {
    const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return exists ? (sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[]) : [];
  };

  return db.tx(async (db) => {
    const [{ n }] = await db.orm.select({ n: count() }).from(schema.accounts);
    if (n > 0) throw new Error(`The target database already has ${n} account(s). Import into an empty database (a fresh Neon branch works well).`);

    const control = open(controlFile);
    const expected: { table: PgTable; name: string; accountId?: number; count: number }[] = [];
    try {
      for (const [t, table] of Object.entries(CONTROL_TABLES)) {
        const rows = read(control, t);
        await insertRows(db, t, table, rows);
        expected.push({ table, name: t, count: rows.length });
        log(`  ${t}: ${rows.length}`);
      }
    } finally {
      control.close();
    }

    const accountIds = new Set((await db.orm.select({ id: schema.accounts.id }).from(schema.accounts)).map((r) => r.id));
    const tenantDir = path.join(dataDir, "tenants");
    const files = fs.existsSync(tenantDir) ? fs.readdirSync(tenantDir).filter((f) => /^\d+\.db$/.test(f)) : [];
    let businesses = 0;
    for (const file of files.sort((a, b) => parseInt(a) - parseInt(b))) {
      const accountId = parseInt(file);
      if (!accountIds.has(accountId)) {
        log(`  skipping tenants/${file}: no such account in control.db (deleted account?)`);
        continue;
      }
      const sqlite = open(path.join(tenantDir, file));
      try {
        const counts: string[] = [];
        for (const [t, table] of Object.entries(BUSINESS_TABLES)) {
          const rows = read(sqlite, t);
          await insertRows(db, t, table, rows, accountId);
          expected.push({ table, name: t, accountId, count: rows.length });
          counts.push(`${t} ${rows.length}`);
          if (t === "documents") {
            const links = rows.filter((r) => r.source_document_id).map((r) => ({ id: r.id, source: r.source_document_id }));
            if (links.length) {
              const d = schema.documents;
              await db.orm.execute(sql`
                UPDATE ${d} SET source_document_id = l.source
                FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id BIGINT, source BIGINT)
                WHERE ${d.accountId} = ${accountId} AND ${d.id} = l.id`);
            }
          }
        }
        businesses++;
        log(`  business ${accountId}: ${counts.join(", ")}`);
      } finally {
        sqlite.close();
      }
    }

    // Verify before committing.
    for (const e of expected) {
      const owned = e.accountId !== undefined ? eq((e.table as typeof schema.customers).accountId, e.accountId) : undefined;
      const [{ n: got }] = await db.orm.select({ n: count() }).from(e.table).where(owned);
      if (got !== e.count) throw new Error(`Row count mismatch for ${e.name}${e.accountId ? ` (business ${e.accountId})` : ""}: SQLite ${e.count}, Postgres ${got}`);
    }
    await syncSequences(db, schema.ID_TABLES);
    log(`Imported ${accountIds.size} account(s) and ${businesses} business database(s). Row counts verified.`);
    return { accounts: accountIds.size, businesses };
  });
}
