import crypto from "node:crypto";
import type { DB } from "../db";
import { nowIso } from "../db";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  accountId: number;
  businessName: string;
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailTakenError";
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Create a business account with its owner login and a trial subscription.
 * The business database itself is created lazily on first use.
 */
export function createAccount(
  db: DB,
  input: { name: string; businessName: string; email: string; password: string },
  opts: { trialDays: number },
): { accountId: number; userId: number } {
  const hash = hashPassword(input.password);
  return db.transaction(() => {
    const email = normalizeEmail(input.email);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new EmailTakenError();
    const now = nowIso();
    const accountId = Number(
      db.prepare("INSERT INTO accounts (business_name, created_at) VALUES (?, ?)").run(input.businessName, now).lastInsertRowid,
    );
    const userId = Number(
      db
        .prepare("INSERT INTO users (account_id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(accountId, input.name, email, hash, now).lastInsertRowid,
    );
    const trialEnds = new Date(Date.parse(now) + Math.max(0, opts.trialDays) * 86_400_000).toISOString();
    db.prepare("INSERT INTO subscriptions (account_id, status, trial_ends_at, updated_at) VALUES (?, 'trialing', ?, ?)").run(
      accountId,
      trialEnds,
      now,
    );
    return { accountId, userId };
  })();
}

/** Set a new password and sign out every existing session for that user. */
export function setPassword(db: DB, userId: number, password: string): boolean {
  const hash = hashPassword(password);
  return db.transaction(() => {
    const res = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return res.changes > 0;
  })();
}

export function findUserIdByEmail(db: DB, email: string): number | null {
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizeEmail(email)) as { id: number } | undefined;
  return row?.id ?? null;
}

export function checkPassword(db: DB, userId: number, password: string): boolean {
  const row = db.prepare("SELECT password_hash AS hash FROM users WHERE id = ?").get(userId) as { hash: string } | undefined;
  return verifyPassword(password, row?.hash ?? DUMMY_HASH) && !!row;
}

// A fixed dummy hash keeps timing similar whether or not the username exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

const USER_COLUMNS = `u.id, u.name, u.email, u.account_id AS accountId, a.business_name AS businessName`;

export function authenticate(db: DB, email: string, password: string): SessionUser | null {
  const user = db
    .prepare(`SELECT ${USER_COLUMNS}, u.password_hash AS hash FROM users u JOIN accounts a ON a.id = u.account_id WHERE u.email = ?`)
    .get(normalizeEmail(email)) as (SessionUser & { hash: string }) | undefined;
  const ok = verifyPassword(password, user?.hash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  const { hash: _hash, ...rest } = user;
  return rest;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Returns the raw token for the cookie; only its hash is stored. */
export function createSession(db: DB, userId: number, days: number): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    sha256(token),
    userId,
    expiresAt.toISOString(),
    nowIso(),
  );
  return { token, expiresAt };
}

export function sessionUser(db: DB, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id JOIN accounts a ON a.id = u.account_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowIso()) as SessionUser | undefined;
  return row ?? null;
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

const RESET_MINUTES = 60;

/** Returns a one-time reset token to email, or null when no such user exists. */
export function createPasswordReset(db: DB, email: string): string | null {
  const userId = findUserIdByEmail(db, email);
  if (!userId) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").run(userId, now);
    db.prepare("INSERT INTO password_resets (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
      sha256(token),
      userId,
      new Date(Date.parse(now) + RESET_MINUTES * 60_000).toISOString(),
      now,
    );
  })();
  return token;
}

export function isResetTokenValid(db: DB, token: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?")
    .get(sha256(token), nowIso());
}

/** Use a reset token once. Returns the user id on success. */
export function resetPassword(db: DB, token: string, password: string): number | null {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT user_id AS userId FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?")
      .get(sha256(token), nowIso()) as { userId: number } | undefined;
    if (!row) return null;
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(nowIso(), sha256(token));
    setPassword(db, row.userId, password);
    return row.userId;
  })();
}

/** Remove an account, its logins and billing records. The caller deletes the business database file. */
export function deleteAccount(db: DB, accountId: number): void {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
}
