/**
 * Drizzle schema: the single source of truth for the database structure.
 * After changing it, run `npm run db:generate` to write a migration into ./drizzle,
 * review the SQL, and commit both. See docs/DATABASE.md.
 *
 * Conventions: money columns are BIGINT minor units, quantities are BIGINT
 * thousandths, rates are INTEGER basis points, dates are TEXT 'YYYY-MM-DD',
 * timestamps are TEXT ISO-8601 UTC (the same values the SQLite version stored,
 * so code compares them as strings and backups stay compatible).
 *
 * Tenancy: every business table has account_id, a (account_id, id) primary key and
 * composite foreign keys, so rows can only reference rows of the same business and
 * are removed with their account. Constraint names are spelled out so they match
 * Postgres's own defaults (and databases created before Drizzle was introduced).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => bigint("id", { mode: "number" }).generatedByDefaultAsIdentity();
const big = (name: string) => bigint(name, { mode: "number" });
const accountId = () => big("account_id").notNull();

// ---------- Accounts, logins and billing ----------

export const accounts = pgTable("accounts", {
  id: id().primaryKey(),
  businessName: text("business_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: id().primaryKey(),
    accountId: accountId(),
    name: text("name").notNull(),
    /** Stored lower-cased (normalizeEmail). */
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner"] }).notNull().default("owner"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "users_account_id_fkey", columns: [t.accountId], foreignColumns: [accounts.id] }).onDelete("cascade"),
    check("users_role_check", sql`${t.role} IN ('owner')`),
    uniqueIndex("users_email").on(sql`lower(${t.email})`),
    index("users_account").on(t.accountId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the cookie token, never the token itself. */
    id: text("id").primaryKey(),
    userId: big("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "sessions_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
    index("sessions_user").on(t.userId),
    index("sessions_expires").on(t.expiresAt),
  ],
);

export const passwordResets = pgTable(
  "password_resets",
  {
    /** SHA-256 of the emailed token. */
    id: text("id").primaryKey(),
    userId: big("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "password_resets_user_id_fkey", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
    index("password_resets_user").on(t.userId),
  ],
);

/** One row per account. Access rules live in services/billing.ts. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    accountId: big("account_id").primaryKey(),
    status: text("status", { enum: ["trialing", "active", "past_due", "canceled"] }).notNull(),
    provider: text("provider", { enum: ["stripe", "bkash"] }),
    trialEndsAt: text("trial_ends_at"),
    currentPeriodEnd: text("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "subscriptions_account_id_fkey", columns: [t.accountId], foreignColumns: [accounts.id] }).onDelete("cascade"),
    check("subscriptions_status_check", sql`${t.status} IN ('trialing','active','past_due','canceled')`),
    check("subscriptions_provider_check", sql`${t.provider} IN ('stripe','bkash')`),
    unique("subscriptions_stripe_customer_id_key").on(t.stripeCustomerId),
    unique("subscriptions_stripe_subscription_id_key").on(t.stripeSubscriptionId),
  ],
);

/** Ledger of subscription payments from either provider. */
export const billingPayments = pgTable(
  "billing_payments",
  {
    id: id().primaryKey(),
    accountId: accountId(),
    provider: text("provider", { enum: ["stripe", "bkash"] }).notNull(),
    /** Stripe invoice id or bKash paymentID. */
    providerRef: text("provider_ref").notNull(),
    /** bKash transaction id shown to the customer. */
    trxId: text("trx_id").notNull().default(""),
    amount: big("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["pending", "paid", "failed", "cancelled"] }).notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "billing_payments_account_id_fkey", columns: [t.accountId], foreignColumns: [accounts.id] }).onDelete("cascade"),
    check("billing_payments_provider_check", sql`${t.provider} IN ('stripe','bkash')`),
    check("billing_payments_amount_check", sql`${t.amount} >= 0`),
    check("billing_payments_status_check", sql`${t.status} IN ('pending','paid','failed','cancelled')`),
    unique("billing_payments_provider_provider_ref_key").on(t.provider, t.providerRef),
    index("billing_payments_account").on(t.accountId, t.createdAt.desc()),
  ],
);

/** Webhook ids already processed, so retries are harmless. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (t) => [primaryKey({ name: "webhook_events_pkey", columns: [t.provider, t.eventId] })],
);

// ---------- Business records (scoped by account_id) ----------

const ownedBy = (table: string, col: { name: string } & object) =>
  foreignKey({ name: `${table}_account_id_fkey`, columns: [col as never], foreignColumns: [accounts.id] }).onDelete("cascade");

export const settings = pgTable(
  "settings",
  {
    accountId: accountId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [ownedBy("settings", t.accountId), primaryKey({ name: "settings_pkey", columns: [t.accountId, t.key] })],
);

export const customers = pgTable(
  "customers",
  {
    accountId: accountId(),
    id: id(),
    name: text("name").notNull(),
    company: text("company").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default(""),
    taxId: text("tax_id").notNull().default(""),
    notes: text("notes").notNull().default(""),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    ownedBy("customers", t.accountId),
    primaryKey({ name: "customers_pkey", columns: [t.accountId, t.id] }),
    index("customers_name").on(t.accountId, sql`lower(${t.name})`),
  ],
);

/** Quotations and invoices share one table; kind decides which status set applies. */
export const documents = pgTable(
  "documents",
  {
    accountId: accountId(),
    id: id(),
    kind: text("kind", { enum: ["quotation", "invoice"] }).notNull(),
    number: text("number").notNull(),
    status: text("status").notNull(),
    customerId: big("customer_id").notNull(),
    issueDate: text("issue_date").notNull(),
    /** Invoice: payment due. Quotation: valid until. */
    dueDate: text("due_date"),
    currency: text("currency", { enum: ["BDT", "USD"] }).notNull(),
    subtotal: big("subtotal").notNull().default(0),
    discountTotal: big("discount_total").notNull().default(0),
    taxTotal: big("tax_total").notNull().default(0),
    total: big("total").notNull().default(0),
    amountPaid: big("amount_paid").notNull().default(0),
    notes: text("notes").notNull().default(""),
    terms: text("terms").notNull().default(""),
    /** Invoice created from this quotation. */
    sourceDocumentId: big("source_document_id"),
    sentAt: text("sent_at"),
    paidAt: text("paid_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    ownedBy("documents", t.accountId),
    primaryKey({ name: "documents_pkey", columns: [t.accountId, t.id] }),
    unique("documents_account_id_kind_number_key").on(t.accountId, t.kind, t.number),
    foreignKey({ name: "documents_account_id_customer_id_fkey", columns: [t.accountId, t.customerId], foreignColumns: [customers.accountId, customers.id] }),
    foreignKey({ name: "documents_account_id_source_document_id_fkey", columns: [t.accountId, t.sourceDocumentId], foreignColumns: [t.accountId, t.id] }),
    check("documents_kind_check", sql`${t.kind} IN ('quotation','invoice')`),
    check("documents_currency_check", sql`${t.currency} IN ('BDT','USD')`),
    check("documents_subtotal_check", sql`${t.subtotal} >= 0`),
    check("documents_discount_total_check", sql`${t.discountTotal} >= 0`),
    check("documents_tax_total_check", sql`${t.taxTotal} >= 0`),
    check("documents_total_check", sql`${t.total} >= 0`),
    check("documents_check", sql`${t.amountPaid} >= 0 AND ${t.amountPaid} <= ${t.total}`),
    index("documents_customer").on(t.accountId, t.customerId),
    index("documents_kind_status").on(t.accountId, t.kind, t.status),
    uniqueIndex("documents_one_invoice_per_quotation").on(t.accountId, t.sourceDocumentId).where(sql`${t.sourceDocumentId} IS NOT NULL`),
  ],
);

export const documentItems = pgTable(
  "document_items",
  {
    accountId: accountId(),
    id: id(),
    documentId: big("document_id").notNull(),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantityMilli: big("quantity_milli").notNull(),
    unitPrice: big("unit_price").notNull(),
    discountType: text("discount_type", { enum: ["percent", "amount"] }).notNull(),
    discountValue: big("discount_value").notNull().default(0),
    taxName: text("tax_name").notNull().default(""),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    lineTotal: big("line_total").notNull(),
  },
  (t) => [
    ownedBy("document_items", t.accountId),
    primaryKey({ name: "document_items_pkey", columns: [t.accountId, t.id] }),
    foreignKey({ name: "document_items_account_id_document_id_fkey", columns: [t.accountId, t.documentId], foreignColumns: [documents.accountId, documents.id] }).onDelete("cascade"),
    check("document_items_quantity_milli_check", sql`${t.quantityMilli} > 0`),
    check("document_items_unit_price_check", sql`${t.unitPrice} >= 0`),
    check("document_items_discount_type_check", sql`${t.discountType} IN ('percent','amount')`),
    check("document_items_discount_value_check", sql`${t.discountValue} >= 0`),
    check("document_items_tax_rate_bps_check", sql`${t.taxRateBps} >= 0`),
    check("document_items_line_total_check", sql`${t.lineTotal} >= 0`),
    index("document_items_document").on(t.accountId, t.documentId, t.position),
  ],
);

export const payments = pgTable(
  "payments",
  {
    accountId: accountId(),
    id: id(),
    invoiceId: big("invoice_id").notNull(),
    amount: big("amount").notNull(),
    paidAt: text("paid_at").notNull(),
    method: text("method").notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    ownedBy("payments", t.accountId),
    primaryKey({ name: "payments_pkey", columns: [t.accountId, t.id] }),
    foreignKey({ name: "payments_account_id_invoice_id_fkey", columns: [t.accountId, t.invoiceId], foreignColumns: [documents.accountId, documents.id] }),
    check("payments_amount_check", sql`${t.amount} > 0`),
    index("payments_invoice").on(t.accountId, t.invoiceId),
    index("payments_paid_at").on(t.accountId, t.paidAt),
  ],
);

/*
 * follow_ups and activities point at documents with ON DELETE SET NULL (document_id):
 * deleting a draft clears only document_id and keeps account_id. Drizzle cannot express
 * a column list on SET NULL, so the migration SQL adds it by hand (drizzle/0000_*.sql).
 * Drizzle Kit compares against this schema, which says plain SET NULL; that is expected.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    accountId: accountId(),
    id: id(),
    title: text("title").notNull(),
    note: text("note").notNull().default(""),
    dueDate: text("due_date").notNull(),
    status: text("status", { enum: ["pending", "completed"] }).notNull().default("pending"),
    customerId: big("customer_id"),
    documentId: big("document_id"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    ownedBy("follow_ups", t.accountId),
    primaryKey({ name: "follow_ups_pkey", columns: [t.accountId, t.id] }),
    foreignKey({ name: "follow_ups_account_id_customer_id_fkey", columns: [t.accountId, t.customerId], foreignColumns: [customers.accountId, customers.id] }),
    foreignKey({ name: "follow_ups_account_id_document_id_fkey", columns: [t.accountId, t.documentId], foreignColumns: [documents.accountId, documents.id] }).onDelete("set null"),
    check("follow_ups_status_check", sql`${t.status} IN ('pending','completed')`),
    index("follow_ups_due").on(t.accountId, t.status, t.dueDate),
  ],
);

export const activities = pgTable(
  "activities",
  {
    accountId: accountId(),
    id: id(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    customerId: big("customer_id"),
    documentId: big("document_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    ownedBy("activities", t.accountId),
    primaryKey({ name: "activities_pkey", columns: [t.accountId, t.id] }),
    foreignKey({ name: "activities_account_id_customer_id_fkey", columns: [t.accountId, t.customerId], foreignColumns: [customers.accountId, customers.id] }),
    foreignKey({ name: "activities_account_id_document_id_fkey", columns: [t.accountId, t.documentId], foreignColumns: [documents.accountId, documents.id] }).onDelete("set null"),
    index("activities_created").on(t.accountId, t.createdAt.desc()),
    index("activities_customer").on(t.accountId, t.customerId),
  ],
);

/** Tables with an identity id column, for syncSequences after explicit-id inserts. */
export const ID_TABLES = [
  "accounts",
  "users",
  "billing_payments",
  "customers",
  "documents",
  "document_items",
  "payments",
  "follow_ups",
  "activities",
] as const;
