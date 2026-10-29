import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import { makeFormatter } from "../format";
import { getDictionary } from "../i18n";
import { sessionUser } from "../services/auth";
import { getSettings } from "../services/settings";

export const SESSION_COOKIE = "bf_session";

export const currentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(getDb(), token);
});

/** Every page, server action and route handler that touches business data calls this first. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Per-request bundle of db, settings, dictionary and formatters. */
export const getContext = cache(async () => {
  const db = getDb();
  const settings = getSettings(db);
  const t = getDictionary(settings.locale);
  const fmt = makeFormatter({ locale: settings.locale, dateFormat: settings.dateFormat });
  return { db, settings, t, fmt, locale: settings.locale };
});

/** Auth check + context for pages. Pages must call this themselves: layouts are not re-run on client navigation. */
export async function pageContext() {
  const user = await requireUser();
  return { ...(await getContext()), user };
}
