import type { DB } from "../db";
import { nowIso } from "../db";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";

/** Tables holding business records, in an order that is safe for deletes (children first). */
const BUSINESS_TABLES = ["activities", "follow_ups", "payments", "document_items", "documents", "customers"] as const;

/**
 * Remove all customers, documents, payments, follow-ups and activity.
 * Business settings are kept but document numbering restarts at 1.
 * The login account is never touched.
 */
export function resetBusinessData(db: DB, opts: { resetSettings?: boolean } = {}): void {
  db.transaction(() => {
    // documents reference each other (source_document_id), so clear that link first.
    db.prepare("UPDATE documents SET source_document_id = NULL").run();
    for (const t of BUSINESS_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    const settings = opts.resetSettings ? structuredClone(DEFAULT_SETTINGS) : getSettings(db);
    settings.invoiceNumbering.next = 1;
    settings.quotationNumbering.next = 1;
    saveSettings(db, settings);
  })();
}

export interface Backup {
  app: "bizflow-kit";
  version: 1;
  exportedAt: string;
  settings: unknown;
  tables: Record<(typeof BUSINESS_TABLES)[number], Record<string, unknown>[]>;
}

/** Full JSON export of business data and settings. Password hashes and sessions are excluded. */
export function exportBackup(db: DB): Backup {
  const tables = {} as Backup["tables"];
  for (const t of BUSINESS_TABLES) tables[t] = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all() as Record<string, unknown>[];
  return { app: "bizflow-kit", version: 1, exportedAt: nowIso(), settings: getSettings(db), tables };
}

/** Replace all business data with the contents of a backup. Runs in one transaction. */
export function restoreBackup(db: DB, backup: Backup): void {
  if (backup?.app !== "bizflow-kit" || backup.version !== 1 || !backup.tables) throw new Error("Not a BizFlow Kit backup file");
  db.transaction(() => {
    resetBusinessData(db);
    // Insert parents first; documents are inserted without their source link, then linked.
    const order = ["customers", "documents", "document_items", "payments", "follow_ups", "activities"] as const;
    for (const t of order) {
      const rows = backup.tables[t] ?? [];
      const allowed = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => allowed.has(k));
        const values = cols.map((c) => (t === "documents" && c === "source_document_id" ? null : row[c]));
        db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...(values as never[]));
      }
    }
    const link = db.prepare("UPDATE documents SET source_document_id = ? WHERE id = ?");
    for (const row of backup.tables.documents ?? []) if (row.source_document_id) link.run(row.source_document_id, row.id);
    saveSettings(db, backup.settings as never);
  })();
}
