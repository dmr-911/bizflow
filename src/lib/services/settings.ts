import type { DB } from "../db";
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

export function getSettings(db: DB): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const stored = JSON.parse(row.value) as Partial<Settings>;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    business: { ...DEFAULT_SETTINGS.business, ...stored.business },
  };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(db: DB, settings: Settings): Settings {
  const valid = settingsSchema.parse(settings);
  const defaults = valid.taxRates.filter((t) => t.isDefault);
  if (valid.taxRates.length > 0 && defaults.length !== 1) {
    valid.taxRates = valid.taxRates.map((t, i) => ({ ...t, isDefault: i === 0 }));
  }
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, JSON.stringify(valid), nowIso());
  return valid;
}

export function updateSettings(db: DB, patch: (s: Settings) => Settings): Settings {
  return db.transaction(() => saveSettings(db, patch(getSettings(db))))();
}
