import { and, asc, isNotNull, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type { TenantDb } from "../db";
import { nowIso, syncSequences } from "../db";
import { activities, customers, documentItems, documents, followUps, payments } from "../db/schema";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings";

/** Tables holding business records, in an order that is safe for deletes (children first). */
const BUSINESS = {
  activities,
  follow_ups: followUps,
  payments,
  document_items: documentItems,
  documents,
  customers,
} as const;
type BusinessTable = keyof typeof BUSINESS;
const BUSINESS_TABLES = Object.keys(BUSINESS) as BusinessTable[];

/**
 * Remove all customers, documents, payments, follow-ups and activity.
 * Business settings are kept but document numbering restarts at 1.
 * The login account is never touched.
 */
export async function resetBusinessData(db: TenantDb, opts: { resetSettings?: boolean } = {}): Promise<void> {
  await db.tx(async (db) => {
    // documents reference each other (source_document_id), so clear that link first.
    await db.orm
      .update(documents)
      .set({ sourceDocumentId: null })
      .where(and(db.owns(documents), isNotNull(documents.sourceDocumentId)));
    for (const t of BUSINESS_TABLES) await db.orm.delete(BUSINESS[t]).where(db.owns(BUSINESS[t]));
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
  /** Rows keyed by database column name (snake_case), as in the SQLite days. */
  tables: Record<BusinessTable, Record<string, unknown>[]>;
}

/**
 * Full JSON export of business data and settings. Password hashes and sessions are excluded.
 * account_id is left out, so a backup has the same shape as before the move to Postgres
 * and can be restored into any account.
 */
export async function exportBackup(db: TenantDb): Promise<Backup> {
  const tables = {} as Backup["tables"];
  for (const t of BUSINESS_TABLES) {
    const table = BUSINESS[t];
    // Raw rows keep the column names, which is the backup format.
    const rows = await db.rows(sql`SELECT * FROM ${table} WHERE ${db.owns(table)} ORDER BY ${asc(table.id)}`);
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
      const allowed = tableColumns(BUSINESS[t]);
      allowed.delete("account_id");
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => allowed.has(k));
      const data = t === "documents" ? rows.map((r) => ({ ...r, source_document_id: null })) : rows;
      await insertJsonRows(db, t, cols, data, { accountId: db.accountId });
    }
    const links = (backup.tables.documents ?? [])
      .filter((r) => r.source_document_id)
      .map((r) => ({ id: r.id, source: r.source_document_id }));
    if (links.length > 0) {
      await db.orm.execute(sql`
        UPDATE ${documents} SET source_document_id = l.source
        FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id BIGINT, source BIGINT)
        WHERE ${db.owns(documents)} AND ${documents.id} = l.id`);
    }
    await saveSettings(db, backup.settings as never);
    // The backup brought its own ids; make sure new rows are numbered after them.
    await syncSequences(db, BUSINESS_TABLES);
  });
}

/** Column names of a table, from the Drizzle schema. */
export function tableColumns(table: PgTable): Set<string> {
  return new Set(getTableConfig(table).columns.map((c) => c.name));
}

/**
 * Bulk insert rows keyed by column name, in one statement: Postgres turns the JSON into
 * typed records (jsonb_populate_recordset), so this is fast over a hosted connection.
 * `cols` must already be checked against tableColumns. With accountId, every row gets it.
 */
export async function insertJsonRows(
  db: { orm: TenantDb["orm"] },
  table: string,
  cols: string[],
  rows: Record<string, unknown>[],
  opts: { accountId?: number } = {},
): Promise<void> {
  const name = sql.identifier(table);
  const list = sql.raw(cols.map((c) => `"${c}"`).join(", "));
  const json = JSON.stringify(rows);
  await db.orm.execute(
    opts.accountId === undefined
      ? sql`INSERT INTO ${name} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${name}, ${json}::jsonb)`
      : sql`INSERT INTO ${name} (account_id, ${list})
            SELECT ${opts.accountId}::bigint, ${list} FROM jsonb_populate_recordset(NULL::${name}, ${json}::jsonb)`,
  );
}
