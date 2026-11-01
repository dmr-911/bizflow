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
import { syncSequences, type Db } from "../src/lib/db";
import { ID_TABLES } from "../src/lib/db/migrations";

type Row = Record<string, unknown>;

const CONTROL_TABLES = ["accounts", "users", "sessions", "password_resets", "subscriptions", "billing_payments", "webhook_events"] as const;
// Parents before children. documents.source_document_id is linked in a second pass.
const BUSINESS_TABLES = ["settings", "customers", "documents", "document_items", "payments", "follow_ups", "activities"] as const;
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

async function columnsOf(db: Db, table: string): Promise<Set<string>> {
  const rows = await db.all<{ name: string }>(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    table,
  );
  return new Set(rows.map((r) => r.name));
}

/** Bulk insert: Postgres turns each chunk of JSON rows into typed records. Business rows get `accountId`. */
async function insertRows(db: Db, table: string, rows: Row[], accountId?: number): Promise<void> {
  if (rows.length === 0) return;
  const target = await columnsOf(db, table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => target.has(c) && c !== "account_id");
  if (target.has("account_id") && accountId === undefined) cols.unshift("account_id");
  const into = accountId === undefined ? cols : ["account_id", ...cols];
  const select = accountId === undefined ? cols : ["$2::bigint", ...cols];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => convert(table, r));
    await db.run(
      `INSERT INTO ${table} (${into.join(", ")}) SELECT ${select.join(", ")} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
      JSON.stringify(chunk),
      ...(accountId === undefined ? [] : [accountId]),
    );
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
    const { n } = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM accounts"))!;
    if (n > 0) throw new Error(`The target database already has ${n} account(s). Import into an empty database (a fresh Neon branch works well).`);

    const control = open(controlFile);
    const expected: { table: string; accountId?: number; count: number }[] = [];
    try {
      for (const t of CONTROL_TABLES) {
        const rows = read(control, t);
        await insertRows(db, t, rows);
        expected.push({ table: t, count: rows.length });
        log(`  ${t}: ${rows.length}`);
      }
    } finally {
      control.close();
    }

    const accountIds = new Set((await db.all<{ id: number }>("SELECT id FROM accounts")).map((r) => r.id));
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
        for (const t of BUSINESS_TABLES) {
          const rows = read(sqlite, t);
          await insertRows(db, t, rows, accountId);
          expected.push({ table: t, accountId, count: rows.length });
          counts.push(`${t} ${rows.length}`);
          if (t === "documents") {
            const links = rows.filter((r) => r.source_document_id).map((r) => ({ id: r.id, source: r.source_document_id }));
            if (links.length) {
              await db.run(
                `UPDATE documents d SET source_document_id = l.source
                 FROM jsonb_to_recordset($2::jsonb) AS l(id BIGINT, source BIGINT)
                 WHERE d.account_id = $1 AND d.id = l.id`,
                accountId,
                JSON.stringify(links),
              );
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
      const where = e.accountId !== undefined ? "WHERE account_id = $1" : "";
      const { n: got } = (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${e.table} ${where}`, ...(e.accountId !== undefined ? [e.accountId] : [])))!;
      if (got !== e.count) throw new Error(`Row count mismatch for ${e.table}${e.accountId ? ` (business ${e.accountId})` : ""}: SQLite ${e.count}, Postgres ${got}`);
    }
    await syncSequences(db, ID_TABLES);
    log(`Imported ${accountIds.size} account(s) and ${businesses} business database(s). Row counts verified.`);
    return { accounts: accountIds.size, businesses };
  });
}
