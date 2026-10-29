-- Schema of control.db as created by the SQLite version (before the move to Postgres).
-- Used by tests/sqlite-import.test.ts.
CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at    TEXT NOT NULL
);
CREATE INDEX users_account ON users(account_id);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the cookie token, never the token itself
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the emailed token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

-- One row per account. Access is allowed while status is trialing/active and
-- the relevant end date is in the future (see services/billing.ts).
CREATE TABLE subscriptions (
  account_id             INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status                 TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  provider               TEXT CHECK (provider IN ('stripe','bkash')),
  trial_ends_at          TEXT,
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  updated_at             TEXT NOT NULL
);

-- Ledger of subscription payments from either provider.
CREATE TABLE billing_payments (
  id           INTEGER PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('stripe','bkash')),
  provider_ref TEXT NOT NULL,           -- Stripe invoice id or bKash paymentID
  trx_id       TEXT NOT NULL DEFAULT '', -- bKash transaction id shown to the customer
  amount       INTEGER NOT NULL CHECK (amount >= 0),
  currency     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','paid','failed','cancelled')),
  period_start TEXT,
  period_end   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (provider, provider_ref)
);
CREATE INDEX billing_payments_account ON billing_payments(account_id, created_at DESC);

-- Webhook ids already processed, so retries are harmless.
CREATE TABLE webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);
