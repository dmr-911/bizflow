"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, getTenantDb } from "@/lib/db";
import { getDictionary, interpolate } from "@/lib/i18n";
import {
  authenticate,
  checkPassword,
  createAccount,
  createPasswordReset,
  createSession,
  deleteAccount,
  deleteSession,
  EmailTakenError,
  resetPassword,
  setPassword,
} from "@/lib/services/auth";
import { getSubscription, trialDays } from "@/lib/services/billing";
import { updateSettings } from "@/lib/services/settings";
import { stripeClient } from "@/lib/billing/stripe";
import { appUrl, clientIp } from "@/lib/server/app-url";
import { requestLocale, requireUser, SESSION_COOKIE, visitorLocale } from "@/lib/server/context";
import { sendMail } from "@/lib/server/mail";
import { clearAttempts, tooManyAttempts } from "@/lib/server/rate-limit";
import { emailSchema, fieldErrors, newPasswordSchema, signupSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/server/action";

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 14;

async function startSession(userId: number) {
  const { token, expiresAt } = await createSession(await getDb(), userId, SESSION_DAYS);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

/** Only same-site paths, so a crafted ?next= cannot send people elsewhere. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

const dict = async () => getDictionary(await visitorLocale());

export async function loginAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = await dict();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const key = `login|${await clientIp()}|${email}`;
  if (tooManyAttempts(key)) return { ok: false, error: t.auth.tooMany };
  const user = await authenticate(await getDb(), email, password);
  if (!user) return { ok: false, error: t.auth.invalid };
  clearAttempts(key);
  await startSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function signupAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  // Bots fill every field; people never see this one.
  if (String(form.get("website") ?? "") !== "") return { ok: false, error: t.common.error };
  // Generous limit: many mobile users in Bangladesh share one carrier IP.
  if (tooManyAttempts(`signup|${await clientIp()}`, 20, 60 * 60_000)) return { ok: false, error: t.auth.tooMany };
  const parsed = signupSchema(t.auth.errors).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: t.auth.fixFields, fieldErrors: fieldErrors(parsed.error) };
  const { name, businessName, email, password } = parsed.data;
  let userId: number;
  try {
    const created = await createAccount(await getDb(), { name, businessName, email, password }, { trialDays: trialDays() });
    userId = created.userId;
    // Start the business settings with the details we already know.
    await updateSettings(await getTenantDb(created.accountId), (s) => ({ ...s, locale, business: { ...s.business, name: businessName, email } }));
  } catch (e) {
    if (e instanceof EmailTakenError) return { ok: false, error: t.auth.emailTaken, fieldErrors: { email: t.auth.emailTaken } };
    throw e;
  }
  await startSession(userId);
  redirect("/dashboard?welcome=1");
}

export async function logoutAction() {
  const jar = await cookies();
  await deleteSession(await getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function forgotPasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = await dict();
  const parsed = emailSchema(t.auth.errors).safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, error: t.auth.fixFields, fieldErrors: { email: t.auth.errors.emailInvalid } };
  if (tooManyAttempts(`forgot|${await clientIp()}`, 5, 60 * 60_000)) return { ok: false, error: t.auth.tooMany };
  const token = await createPasswordReset(await getDb(), parsed.data);
  if (token) {
    const link = `${await appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail({ to: parsed.data, subject: t.auth.resetEmailSubject, text: interpolate(t.auth.resetEmailBody, { link }) });
  }
  // Same answer either way, so the form does not reveal who has an account.
  return { ok: true, message: t.auth.forgotSent };
}

export async function resetPasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const t = await dict();
  const parsed = newPasswordSchema(t.auth.errors).safeParse(form.get("password"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fieldErrors: { password: parsed.error.issues[0].message } };
  const userId = await resetPassword(await getDb(), String(form.get("token") ?? ""), parsed.data);
  if (!userId) return { ok: false, error: t.auth.resetInvalid };
  await startSession(userId);
  redirect("/dashboard");
}

export async function changePasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const t = getDictionary(await requestLocale());
  const db = await getDb();
  if (!(await checkPassword(db, user.id, String(form.get("current") ?? "")))) {
    return { ok: false, error: t.auth.wrongPassword, fieldErrors: { current: t.auth.wrongPassword } };
  }
  const next = newPasswordSchema(t.auth.errors).safeParse(form.get("next"));
  if (!next.success) return { ok: false, error: next.error.issues[0].message, fieldErrors: { next: next.error.issues[0].message } };
  await setPassword(db, user.id, next.data);
  await startSession(user.id);
  return { ok: true, message: t.settings.passwordChanged };
}

/** Permanently deletes the account with all its business records and cancels any Stripe subscription. */
export async function deleteAccountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const t = getDictionary(await requestLocale());
  const db = await getDb();
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") return { ok: false, error: t.billing.deleteConfirmError };
  if (!(await checkPassword(db, user.id, String(form.get("password") ?? "")))) {
    return { ok: false, error: t.auth.wrongPassword, fieldErrors: { password: t.auth.wrongPassword } };
  }
  const sub = await getSubscription(db, user.accountId);
  const stripe = stripeClient();
  if (sub.stripeSubscriptionId && stripe) {
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch (e) {
      console.error("Could not cancel Stripe subscription", sub.stripeSubscriptionId, e);
      return { ok: false, error: t.billing.deleteStripeError };
    }
  }
  await deleteAccount(db, user.accountId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/?deleted=1");
}
