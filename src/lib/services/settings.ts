import type { TenantDb } from "../db";
import { nowIso } from "../db";
import { settingsSchema, type Settings } from "../validation";

export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: "My Business",
    email: "",
    phone: "",
    address: "",
    website: "",
    taxId: "",
  },
  locale: "en",
  defaultCurrency: "BDT",
  dateFormat: "DD/MM/YYYY",
  invoiceNumbering: { prefix: "INV-", padding: 4, next: 1, includeYear: true },
  quotationNumbering: { prefix: "QT-", padding: 4, next: 1, includeYear: true },
  paymentTermsDays: 14,
  quotationValidityDays: 30,
  taxLabel: "VAT",
  taxRates: [
    { id: "none", name: "No tax", rateBps: 0, isDefault: true },
    { id: "vat15", name: "VAT 15%", rateBps: 1500, isDefault: false },
  ],
  invoiceTerms: "Payment is due within the stated terms. Thank you for your business.",
  quotationTerms: "This quotation is valid until the date shown above.",
  documentFooter: "",
};

const KEY = "app";

export async function getSettings(db: TenantDb): Promise<Settings> {
  const row = await db.get<{ value: Partial<Settings> }>("SELECT value FROM settings WHERE account_id = $1 AND key = $2", db.accountId, KEY);
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const stored = row.value;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    business: { ...DEFAULT_SETTINGS.business, ...stored.business },
  };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(db: TenantDb, settings: Settings): Promise<Settings> {
  const valid = settingsSchema.parse(settings);
  const defaults = valid.taxRates.filter((t) => t.isDefault);
  if (valid.taxRates.length > 0 && defaults.length !== 1) {
    valid.taxRates = valid.taxRates.map((t, i) => ({ ...t, isDefault: i === 0 }));
  }
  await db.run(
    `INSERT INTO settings (account_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    db.accountId,
    KEY,
    JSON.stringify(valid),
    nowIso(),
  );
  return valid;
}

export async function updateSettings(db: TenantDb, patch: (s: Settings) => Settings): Promise<Settings> {
  return db.tx(async (db) => saveSettings(db, patch(await getSettings(db))));
}
