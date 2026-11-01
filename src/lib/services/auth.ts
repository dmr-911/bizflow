import crypto from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db";
import { idEq, nowIso, pgError } from "../db";
import { accounts, passwordResets, sessions, subscriptions, users } from "../db/schema";

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
      if (await findUserIdByEmail(db, email)) throw new EmailTakenError();
      const now = nowIso();
      const [{ id: accountId }] = await db.orm
        .insert(accounts)
        .values({ businessName: input.businessName, createdAt: now })
        .returning({ id: accounts.id });
      const [{ id: userId }] = await db.orm
        .insert(users)
        .values({ accountId, name: input.name, email, passwordHash: hash, createdAt: now })
        .returning({ id: users.id });
      const trialEnds = new Date(Date.parse(now) + Math.max(0, opts.trialDays) * 86_400_000).toISOString();
      await db.orm.insert(subscriptions).values({ accountId, status: "trialing", trialEndsAt: trialEnds, updatedAt: now });
      return { accountId, userId };
    });
  } catch (e) {
    // Two signups with the same email at the same moment: the unique index decides.
    const pg = pgError(e);
    if (pg?.code === "23505" && pg.constraint === "users_email") throw new EmailTakenError();
    throw e;
  }
}

/** Set a new password and sign out every existing session for that user. */
export async function setPassword(db: Db, userId: number, password: string): Promise<boolean> {
  const hash = hashPassword(password);
  return db.tx(async (db) => {
    const { rowCount } = await db.orm.update(users).set({ passwordHash: hash }).where(idEq(users.id, userId));
    await db.orm.delete(sessions).where(idEq(sessions.userId, userId));
    return !!rowCount;
  });
}

/** Matches the users_email unique index on lower(email). */
const byEmail = (email: string) => eq(sql`lower(${users.email})`, normalizeEmail(email));

export async function findUserIdByEmail(db: Db, email: string): Promise<number | null> {
  const [row] = await db.orm.select({ id: users.id }).from(users).where(byEmail(email));
  return row?.id ?? null;
}

export async function checkPassword(db: Db, userId: number, password: string): Promise<boolean> {
  const [row] = await db.orm.select({ hash: users.passwordHash }).from(users).where(idEq(users.id, userId));
  return verifyPassword(password, row?.hash ?? DUMMY_HASH) && !!row;
}

// A fixed dummy hash keeps timing similar whether or not the username exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  accountId: users.accountId,
  businessName: accounts.businessName,
};

export async function authenticate(db: Db, email: string, password: string): Promise<SessionUser | null> {
  const [user] = await db.orm
    .select({ ...userColumns, hash: users.passwordHash })
    .from(users)
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(byEmail(email));
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
  await db.orm.delete(sessions).where(lt(sessions.expiresAt, nowIso()));
  await db.orm.insert(sessions).values({ id: sha256(token), userId, expiresAt: expiresAt.toISOString(), createdAt: nowIso() });
  return { token, expiresAt };
}

export async function sessionUser(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db.orm
    .select(userColumns)
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, nowIso())));
  return row ?? null;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.orm.delete(sessions).where(eq(sessions.id, sha256(token)));
}

const RESET_MINUTES = 60;

/** Returns a one-time reset token to email, or null when no such user exists. */
export async function createPasswordReset(db: Db, email: string): Promise<string | null> {
  const userId = await findUserIdByEmail(db, email);
  if (!userId) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const now = nowIso();
  await db.tx(async (db) => {
    await db.orm.delete(passwordResets).where(or(eq(passwordResets.userId, userId), lt(passwordResets.expiresAt, now)));
    await db.orm.insert(passwordResets).values({
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.parse(now) + RESET_MINUTES * 60_000).toISOString(),
      createdAt: now,
    });
  });
  return token;
}

const usableReset = (token: string, now: string) =>
  and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now));

export async function isResetTokenValid(db: Db, token: string): Promise<boolean> {
  const [row] = await db.orm.select({ id: passwordResets.id }).from(passwordResets).where(usableReset(token, nowIso()));
  return !!row;
}

/** Use a reset token once. Returns the user id on success. */
export async function resetPassword(db: Db, token: string, password: string): Promise<number | null> {
  return db.tx(async (db) => {
    // Marking it used first, with a row lock, means two simultaneous submits cannot both succeed.
    const now = nowIso();
    const [row] = await db.orm
      .update(passwordResets)
      .set({ usedAt: now })
      .where(usableReset(token, now))
      .returning({ userId: passwordResets.userId });
    if (!row) return null;
    await setPassword(db, row.userId, password);
    return row.userId;
  });
}

/** Remove an account with its logins, billing records and every business record (ON DELETE CASCADE). */
export async function deleteAccount(db: Db, accountId: number): Promise<void> {
  await db.orm.delete(accounts).where(idEq(accounts.id, accountId));
}
