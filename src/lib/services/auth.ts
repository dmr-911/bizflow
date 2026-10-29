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

export function hasUsers(db: DB): boolean {
  return !!db.prepare("SELECT 1 FROM users LIMIT 1").get();
}

export function createUser(db: DB, username: string, password: string): number {
  const res = db
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, hashPassword(password), nowIso());
  return Number(res.lastInsertRowid);
}

export function setPassword(db: DB, username: string, password: string): boolean {
  const res = db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hashPassword(password), username);
  if (res.changes > 0) db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)").run(username);
  return res.changes > 0;
}

// A fixed dummy hash keeps timing similar whether or not the username exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export function authenticate(db: DB, username: string, password: string): { id: number; username: string } | null {
  const user = db.prepare("SELECT id, username, password_hash AS hash FROM users WHERE username = ?").get(username) as
    | { id: number; username: string; hash: string }
    | undefined;
  const ok = verifyPassword(password, user?.hash ?? DUMMY_HASH);
  return user && ok ? { id: user.id, username: user.username } : null;
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

export function sessionUser(db: DB, token: string | undefined): { id: number; username: string } | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowIso()) as { id: number; username: string } | undefined;
  return row ?? null;
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}
