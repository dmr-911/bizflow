import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getControlDb, getTenantDb } from "../db";
import { makeFormatter } from "../format";
import { getDictionary, type Locale } from "../i18n";
import { sessionUser } from "../services/auth";
import { accessState, getSubscription } from "../services/billing";
import { getSettings } from "../services/settings";

export const SESSION_COOKIE = "bf_session";
export const LOCALE_COOKIE = "bf_locale";

export const currentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(getControlDb(), token);
});

/** Signed in, whether or not the subscription is paid. Used by billing and account pages. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export const currentAccess = cache(async () => {
  const user = await currentUser();
  return user ? accessState(getSubscription(getControlDb(), user.accountId)) : null;
});

/**
 * Every page, server action and route handler that touches business data calls this first.
 * Returns the signed-in user and their business database; lapsed accounts go to billing.
 */
export async function requireAccess() {
  const user = await requireUser();
  const access = (await currentAccess())!;
  if (!access.allowed) redirect("/billing");
  return { user, db: getTenantDb(user.accountId), access };
}

/** Locale for public pages: cookie, then the browser's preference. */
export const visitorLocale = cache(async (): Promise<Locale> => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (saved === "bn" || saved === "en") return saved;
  return /^bn\b/i.test((await headers()).get("accept-language") ?? "") ? "bn" : "en";
});

/** Locale for any page: the business setting when signed in, otherwise the visitor's. */
export const requestLocale = cache(async (): Promise<Locale> => {
  const user = await currentUser();
  return user ? getSettings(getTenantDb(user.accountId)).locale : visitorLocale();
});

/** Per-request bundle of the business db, settings, dictionary and formatters. */
export const getContext = cache(async () => {
  const { user, db, access } = await requireAccess();
  const settings = getSettings(db);
  const t = getDictionary(settings.locale);
  const fmt = makeFormatter({ locale: settings.locale, dateFormat: settings.dateFormat });
  return { db, settings, t, fmt, locale: settings.locale, user, access };
});

/** Auth + subscription check and context for pages. Pages must call this themselves: layouts are not re-run on client navigation. */
export async function pageContext() {
  return getContext();
}

/** Context for signed-in pages that must work without an active subscription (billing, account). */
export const accountContext = cache(async () => {
  const user = await requireUser();
  const db = getTenantDb(user.accountId);
  const settings = getSettings(db);
  const t = getDictionary(settings.locale);
  const fmt = makeFormatter({ locale: settings.locale, dateFormat: settings.dateFormat });
  return { user, db, settings, t, fmt, locale: settings.locale, access: (await currentAccess())! };
});
