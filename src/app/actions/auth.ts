"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { authenticate, createSession, createUser, deleteSession, hasUsers, setPassword, verifyPassword } from "@/lib/services/auth";
import { getSettings } from "@/lib/services/settings";
import { requireUser, SESSION_COOKIE } from "@/lib/server/context";
import { clearAttempts, tooManyAttempts } from "@/lib/server/rate-limit";
import { fieldErrors, passwordSchema, setupSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/server/action";

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 14;

async function startSession(userId: number) {
  const { token, expiresAt } = createSession(getDb(), userId, SESSION_DAYS);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function loginAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = getDb();
  const t = getDictionary(getSettings(db).locale);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const key = `${ip}|${username.toLowerCase()}`;
  if (tooManyAttempts(key)) return { ok: false, error: t.auth.tooMany };
  const user = authenticate(db, username, password);
  if (!user) return { ok: false, error: t.auth.invalid };
  clearAttempts(key);
  await startSession(user.id);
  redirect("/");
}

export async function setupAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = getDb();
  if (hasUsers(db)) redirect("/login");
  const parsed = setupSchema.safeParse({ username: form.get("username"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  // Check again inside a transaction so two simultaneous setups cannot both succeed.
  const id = db.transaction(() => (hasUsers(db) ? null : createUser(db, parsed.data.username, parsed.data.password)))();
  if (id === null) redirect("/login");
  await startSession(id);
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  deleteSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const db = getDb();
  const t = getDictionary(getSettings(db).locale);
  const row = db.prepare("SELECT password_hash AS hash FROM users WHERE id = ?").get(user.id) as { hash: string };
  if (!verifyPassword(String(form.get("current") ?? ""), row.hash)) {
    return { ok: false, error: t.auth.invalid, fieldErrors: { current: t.auth.invalid } };
  }
  const next = passwordSchema.safeParse(form.get("next"));
  if (!next.success) return { ok: false, error: next.error.issues[0].message, fieldErrors: { next: next.error.issues[0].message } };
  setPassword(db, user.username, next.data);
  await startSession(user.id);
  return { ok: true, message: t.settings.passwordChanged };
}
