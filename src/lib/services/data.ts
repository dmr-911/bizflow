import type { Db, TenantDb } from "../db";
import { nowIso, syncSequences } from "../db";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";

/** Tables holding business records, in an order that is safe for deletes (children first). */
const BUSINESS_TABLES = ["activities", "follow_ups", "payments", "document_items", "documents", "customers"] as const;

/**
 * Remove all customers, documents, payments, follow-ups and activity.
 * Business settings are kept but document numbering restarts at 1.
 * The login account is never touched.
 */
export async function resetBusinessData(db: TenantDb, opts: { resetSettings?: boolean } = {}): Promise<void> {
  await db.tx(async (db) => {
    // documents reference each other (source_document_id), so clear that link first.
    await db.run("UPDATE documents SET source_document_id = NULL WHERE account_id = $1 AND source_document_id IS NOT NULL", db.accountId);
    for (const t of BUSINESS_TABLES) await db.run(`DELETE FROM ${t} WHERE account_id = $1`, db.accountId);
    const settings = opts.resetSettings ? structuredClone(DEFAULT_SETTINGS) : await getSettings(db);
    settings.invoiceNumbering.next = 1;
    settings.quotationNumbering.next = 1;
    await saveSettings(db, settings);
  });
}

export interface Backup {
  app: "bizflow-kit";
  version: 1;
  exportedAt: string;
  settings: unknown;
  tables: Record<(typeof BUSINESS_TABLES)[number], Record<string, unknown>[]>;
}

/**
 * Full JSON export of business data and settings. Password hashes and sessions are excluded.
 * account_id is left out, so a backup has the same shape as before the move to Postgres
 * and can be restored into any account.
 */
export async function exportBackup(db: TenantDb): Promise<Backup> {
  const tables = {} as Backup["tables"];
  for (const t of BUSINESS_TABLES) {
    const rows = await db.all(`SELECT * FROM ${t} WHERE account_id = $1 ORDER BY id`, db.accountId);
    tables[t] = rows.map(({ account_id: _account, ...rest }) => rest);
  }
  return { app: "bizflow-kit", version: 1, exportedAt: nowIso(), settings: await getSettings(db), tables };
}

/** Replace all business data with the contents of a backup. Runs in one transaction. */
export async function restoreBackup(db: TenantDb, backup: Backup): Promise<void> {
  if (backup?.app !== "bizflow-kit" || backup.version !== 1 || !backup.tables) throw new Error("Not a BizFlow Kit backup file");
  await db.tx(async (db) => {
    await resetBusinessData(db);
    // Insert parents first; documents are inserted without their source link, then linked.
    const order = ["customers", "documents", "document_items", "payments", "follow_ups", "activities"] as const;
    for (const t of order) {
      const rows = backup.tables[t] ?? [];
      if (rows.length === 0) continue;
      const allowed = await tableColumns(db, t);
      allowed.delete("account_id");
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => allowed.has(k));
      const data = t === "documents" ? rows.map((r) => ({ ...r, source_document_id: null })) : rows;
      // One statement per table: Postgres turns the JSON rows into typed records.
      await db.run(
        `INSERT INTO ${t} (account_id, ${cols.join(", ")})
         SELECT $1, ${cols.join(", ")} FROM jsonb_populate_recordset(NULL::${t}, $2::jsonb)`,
        db.accountId,
        JSON.stringify(data),
      );
    }
    const links = (backup.tables.documents ?? [])
      .filter((r) => r.source_document_id)
      .map((r) => ({ id: r.id, source: r.source_document_id }));
    if (links.length > 0) {
      await db.run(
        `UPDATE documents d SET source_document_id = l.source
         FROM jsonb_to_recordset($2::jsonb) AS l(id BIGINT, source BIGINT)
         WHERE d.account_id = $1 AND d.id = l.id`,
        db.accountId,
        JSON.stringify(links),
      );
    }
    await saveSettings(db, backup.settings as never);
    // The backup brought its own ids; make sure new rows are numbered after them.
    await syncSequences(db, BUSINESS_TABLES);
  });
}

export async function tableColumns(db: Db, table: string): Promise<Set<string>> {
  const rows = await db.all<{ name: string }>(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    table,
  );
  return new Set(rows.map((r) => r.name));
}
