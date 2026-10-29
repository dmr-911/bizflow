import crypto from "node:crypto";
import type { Db } from "../db";
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
 * Business settings start from defaults until first saved.
 */
export async function createAccount(
  db: Db,
  input: { name: string; businessName: string; email: string; password: string },
  opts: { trialDays: number },
): Promise<{ accountId: number; userId: number }> {
  const hash = hashPassword(input.password);
  const email = normalizeEmail(input.email);
  try {
    return await db.tx(async (db) => {
      if (await db.get("SELECT 1 FROM users WHERE lower(email) = $1", email)) throw new EmailTakenError();
      const now = nowIso();
      const { id: accountId } = (await db.get<{ id: number }>(
        "INSERT INTO accounts (business_name, created_at) VALUES ($1, $2) RETURNING id",
        input.businessName,
        now,
      ))!;
      const { id: userId } = (await db.get<{ id: number }>(
        "INSERT INTO users (account_id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        accountId,
        input.name,
        email,
        hash,
        now,
      ))!;
      const trialEnds = new Date(Date.parse(now) + Math.max(0, opts.trialDays) * 86_400_000).toISOString();
      await db.run(
        "INSERT INTO subscriptions (account_id, status, trial_ends_at, updated_at) VALUES ($1, 'trialing', $2, $3)",
        accountId,
        trialEnds,
        now,
      );
      return { accountId, userId };
    });
  } catch (e) {
    // Two signups with the same email at the same moment: the unique index decides.
    if ((e as { code?: string }).code === "23505" && (e as { constraint?: string }).constraint === "users_email") throw new EmailTakenError();
    throw e;
  }
}

/** Set a new password and sign out every existing session for that user. */
export async function setPassword(db: Db, userId: number, password: string): Promise<boolean> {
  const hash = hashPassword(password);
  return db.tx(async (db) => {
    const changed = await db.run("UPDATE users SET password_hash = $1 WHERE id = $2", hash, userId);
    await db.run("DELETE FROM sessions WHERE user_id = $1", userId);
    return changed > 0;
  });
}

export async function findUserIdByEmail(db: Db, email: string): Promise<number | null> {
  const row = await db.get<{ id: number }>("SELECT id FROM users WHERE lower(email) = $1", normalizeEmail(email));
  return row?.id ?? null;
}

export async function checkPassword(db: Db, userId: number, password: string): Promise<boolean> {
  const row = await db.get<{ hash: string }>("SELECT password_hash AS hash FROM users WHERE id = $1", userId);
  return verifyPassword(password, row?.hash ?? DUMMY_HASH) && !!row;
}

// A fixed dummy hash keeps timing similar whether or not the username exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

const USER_COLUMNS = `u.id, u.name, u.email, u.account_id AS "accountId", a.business_name AS "businessName"`;

export async function authenticate(db: Db, email: string, password: string): Promise<SessionUser | null> {
  const user = await db.get<SessionUser & { hash: string }>(
    `SELECT ${USER_COLUMNS}, u.password_hash AS hash FROM users u JOIN accounts a ON a.id = u.account_id WHERE lower(u.email) = $1`,
    normalizeEmail(email),
  );
  const ok = verifyPassword(password, user?.hash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  const { hash: _hash, ...rest } = user;
  return rest;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Returns the raw token for the cookie; only its hash is stored. */
export async function createSession(db: Db, userId: number, days: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.run("DELETE FROM sessions WHERE expires_at < $1", nowIso());
  await db.run(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    sha256(token),
    userId,
    expiresAt.toISOString(),
    nowIso(),
  );
  return { token, expiresAt };
}

export async function sessionUser(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db.get<SessionUser>(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id JOIN accounts a ON a.id = u.account_id
     WHERE s.id = $1 AND s.expires_at > $2`,
    sha256(token),
    nowIso(),
  );
  return row ?? null;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.run("DELETE FROM sessions WHERE id = $1", sha256(token));
}

const RESET_MINUTES = 60;

/** Returns a one-time reset token to email, or null when no such user exists. */
export async function createPasswordReset(db: Db, email: string): Promise<string | null> {
  const userId = await findUserIdByEmail(db, email);
  if (!userId) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowIso();
  await db.tx(async (db) => {
    await db.run("DELETE FROM password_resets WHERE user_id = $1 OR expires_at < $2", userId, now);
    await db.run(
      "INSERT INTO password_resets (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
      sha256(token),
      userId,
      new Date(Date.parse(now) + RESET_MINUTES * 60_000).toISOString(),
      now,
    );
  });
  return token;
}

export async function isResetTokenValid(db: Db, token: string): Promise<boolean> {
  return !!(await db.get(
    "SELECT 1 FROM password_resets WHERE id = $1 AND used_at IS NULL AND expires_at > $2",
    sha256(token),
    nowIso(),
  ));
}

/** Use a reset token once. Returns the user id on success. */
export async function resetPassword(db: Db, token: string, password: string): Promise<number | null> {
  return db.tx(async (db) => {
    // Marking it used first, with a row lock, means two simultaneous submits cannot both succeed.
    const row = await db.get<{ userId: number }>(
      `UPDATE password_resets SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2
       RETURNING user_id AS "userId"`,
      sha256(token),
      nowIso(),
    );
    if (!row) return null;
    await setPassword(db, row.userId, password);
    return row.userId;
  });
}

/** Remove an account with its logins, billing records and every business record (ON DELETE CASCADE). */
export async function deleteAccount(db: Db, accountId: number): Promise<void> {
  await db.run("DELETE FROM accounts WHERE id = $1", accountId);
}
