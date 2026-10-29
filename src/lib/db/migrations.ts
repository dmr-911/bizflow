/**
 * Schema migrations. Each entry runs once, in order, inside a transaction.
 * Append new migrations; never edit one that has shipped.
 *
 * Conventions: money columns are INTEGER minor units, quantities are INTEGER
 * thousandths, rates are INTEGER basis points, dates are TEXT 'YYYY-MM-DD',
 * timestamps are TEXT ISO-8601 UTC.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial schema",
    sql: `
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the cookie token, never the token itself
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  tax_id      TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX customers_name ON customers(name COLLATE NOCASE);

-- Quotations and invoices share one table; kind decides which status set applies.
CREATE TABLE documents (
  id                 INTEGER PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('quotation','invoice')),
  number             TEXT NOT NULL,
  status             TEXT NOT NULL,
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  issue_date         TEXT NOT NULL,
  due_date           TEXT,               -- invoice: payment due; quotation: valid until
  currency           TEXT NOT NULL CHECK (currency IN ('BDT','USD')),
  subtotal           INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total     INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total          INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total              INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid        INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= total),
  notes              TEXT NOT NULL DEFAULT '',
  terms              TEXT NOT NULL DEFAULT '',
  source_document_id INTEGER REFERENCES documents(id),  -- invoice created from this quotation
  sent_at            TEXT,
  paid_at            TEXT,
  cancelled_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (kind, number)
);
CREATE INDEX documents_customer ON documents(customer_id);
CREATE INDEX documents_kind_status ON documents(kind, status);
CREATE UNIQUE INDEX documents_one_invoice_per_quotation
  ON documents(source_document_id) WHERE source_document_id IS NOT NULL;

CREATE TABLE document_items (
  id             INTEGER PRIMARY KEY,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  description    TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price     INTEGER NOT NULL CHECK (unit_price >= 0),
  discount_type  TEXT NOT NULL CHECK (discount_type IN ('percent','amount')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  tax_name       TEXT NOT NULL DEFAULT '',
  tax_rate_bps   INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0),
  line_total     INTEGER NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX document_items_document ON document_items(document_id, position);

CREATE TABLE payments (
  id          INTEGER PRIMARY KEY,
  invoice_id  INTEGER NOT NULL REFERENCES documents(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  paid_at     TEXT NOT NULL,
  method      TEXT NOT NULL,
  reference   TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX payments_paid_at ON payments(paid_at);

CREATE TABLE follow_ups (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  due_date     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  customer_id  INTEGER REFERENCES customers(id),
  document_id  INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX follow_ups_due ON follow_ups(status, due_date);

CREATE TABLE activities (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX activities_created ON activities(created_at DESC);
CREATE INDEX activities_customer ON activities(customer_id);
`,
  },
];
