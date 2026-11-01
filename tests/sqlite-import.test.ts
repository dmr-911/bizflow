import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getTenantDb } from "@/lib/db";
import { authenticate, hashPassword } from "@/lib/services/auth";
import { getSubscription } from "@/lib/services/billing";
import { createCustomer, listCustomers } from "@/lib/services/customers";
import { getDocument } from "@/lib/services/documents";
import { listFollowUps } from "@/lib/services/followups";
import { getSettings } from "@/lib/services/settings";
import { importSqlite } from "../scripts/sqlite-import";
import { count, sql } from "drizzle-orm";
import { accounts } from "@/lib/db/schema";
import { pgFailure, useTestDatabase } from "./helpers/db";

useTestDatabase();

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const T = "2026-10-01T10:00:00.000Z";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bizflow-sqlite-"));
  fs.mkdirSync(path.join(dir, "tenants"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function sqlite(file: string, schema: string) {
  const db = new Database(path.join(dir, file));
  db.exec(fixture(schema));
  return db;
}

/** Two businesses whose ids overlap, as they did with one file per business. */
function writeOldData() {
  const control = sqlite("control.db", "sqlite-control.sql");
  for (const [id, email] of [[1, "Owner@One.example"], [2, "owner@two.example"]] as const) {
    control.prepare("INSERT INTO accounts (id, business_name, created_at) VALUES (?, ?, ?)").run(id, `Business ${id}`, T);
    control.prepare("INSERT INTO users (id, account_id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, id, "Owner", email, hashPassword("a long password"), T);
  }
  control.prepare("INSERT INTO subscriptions (account_id, status, trial_ends_at, cancel_at_period_end, updated_at) VALUES (1, 'trialing', ?, 0, ?)").run(T, T);
  control.prepare("INSERT INTO subscriptions (account_id, status, provider, current_period_end, cancel_at_period_end, stripe_customer_id, updated_at) VALUES (2, 'active', 'stripe', '2026-12-01T00:00:00.000Z', 1, 'cus_2', ?)").run(T);
  control.prepare("INSERT INTO billing_payments (account_id, provider, provider_ref, amount, currency, status, created_at, updated_at) VALUES (2, 'stripe', 'in_1', 500, 'USD', 'paid', ?, ?)").run(T, T);
  control.close();

  for (const id of [1, 2]) {
    const t = sqlite(`tenants/${id}.db`, "sqlite-tenant.sql");
    t.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('app', ?, ?)").run(JSON.stringify({ locale: id === 1 ? "bn" : "en", business: { name: `দোকান ${id}` } }), T);
    t.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)").run(`Customer of ${id}`, T, T);
    t.prepare("INSERT INTO documents (id, kind, number, status, customer_id, issue_date, currency, total, created_at, updated_at) VALUES (1, 'quotation', 'QT-0001', 'converted', 1, '2026-10-01', 'BDT', 1000, ?, ?)").run(T, T);
    t.prepare("INSERT INTO documents (id, kind, number, status, customer_id, issue_date, currency, total, amount_paid, source_document_id, created_at, updated_at) VALUES (2, 'invoice', 'INV-0001', 'partially_paid', 1, '2026-10-02', 'BDT', 1000, 400, 1, ?, ?)").run(T, T);
    for (const doc of [1, 2]) {
      t.prepare("INSERT INTO document_items (document_id, position, description, quantity_milli, unit_price, discount_type, line_total) VALUES (?, 0, 'Work', 1000, 1000, 'percent', 1000)").run(doc);
    }
    t.prepare("INSERT INTO payments (invoice_id, amount, paid_at, method, created_at) VALUES (2, 400, '2026-10-03', 'bkash', ?)").run(T);
    t.prepare("INSERT INTO follow_ups (title, due_date, customer_id, document_id, created_at) VALUES ('Chase', '2026-10-20', 1, 2, ?)").run(T);
    t.prepare("INSERT INTO activities (type, message, customer_id, document_id, created_at) VALUES ('invoice.created', 'x', 1, 2, ?)").run(T);
    t.close();
  }
  // A business file left behind by a deleted account is skipped.
  sqlite("tenants/9.db", "sqlite-tenant.sql").close();
}

describe("SQLite import", () => {
  it("copies every account and business, keeping ids, links and logins", async () => {
    writeOldData();
    const db = await getDb();
    const logs: string[] = [];
    expect(await importSqlite(db, dir, { log: (m) => logs.push(m) })).toEqual({ accounts: 2, businesses: 2 });
    expect(logs.join("\n")).toMatch(/skipping tenants\/9\.db/);

    expect(await authenticate(db, "owner@one.example", "a long password")).toMatchObject({ id: 1, accountId: 1 });
    expect(await getSubscription(db, 2)).toMatchObject({ status: "active", provider: "stripe", cancelAtPeriodEnd: true, stripeCustomerId: "cus_2" });

    for (const id of [1, 2]) {
      const t = await getTenantDb(id);
      expect((await listCustomers(t)).map((c) => c.name)).toEqual([`Customer of ${id}`]);
      const inv = (await getDocument(t, 2))!;
      expect(inv).toMatchObject({ number: "INV-0001", amountPaid: 400, balance: 600, sourceDocumentId: 1, linked: { id: 1, number: "QT-0001" } });
      expect(inv.payments).toHaveLength(1);
      expect((await listFollowUps(t))[0]).toMatchObject({ documentId: 2, documentNumber: "INV-0001" });
      expect((await getSettings(t)).business.name).toBe(`দোকান ${id}`);
    }

    // New rows are numbered after the imported ones.
    const fresh = await createCustomer(await getTenantDb(1), { name: "New", company: "", email: "", phone: "", address: "", city: "", country: "", taxId: "", notes: "" });
    expect(fresh.id).toBeGreaterThan(1);
  });

  it("refuses to import twice and leaves nothing behind when it fails", async () => {
    writeOldData();
    const db = await getDb();
    await importSqlite(db, dir);
    await expect(importSqlite(db, dir)).rejects.toThrow(/already has 2 account/);

    await db.orm.execute(sql`TRUNCATE accounts, webhook_events RESTART IDENTITY CASCADE`);
    // A payment pointing at a missing invoice breaks the foreign key half way through.
    const broken = new Database(path.join(dir, "tenants", "2.db"));
    broken.pragma("foreign_keys = OFF");
    broken.prepare("INSERT INTO payments (invoice_id, amount, paid_at, method, created_at) VALUES (99, 1, '2026-10-03', 'cash', ?)").run(T);
    broken.close();
    expect(await pgFailure(importSqlite(db, dir))).toMatch(/foreign key/);
    expect(await db.orm.select({ n: count() }).from(accounts)).toEqual([{ n: 0 }]);
  });
});
