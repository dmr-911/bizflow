"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetBusinessData, restoreBackup, type Backup } from "@/lib/services/data";
import { seedDemoData } from "@/lib/services/seed";
import { getSettings, saveSettings, updateSettings } from "@/lib/services/settings";
import { cookies } from "next/headers";
import { getTenantDb } from "@/lib/db";
import { currentUser, LOCALE_COOKIE, requireAccess } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";
import { getDictionary } from "@/lib/i18n";
import type { Settings } from "@/lib/validation";

/** Works signed in (saves the business setting) and signed out (remembers the visitor's choice). */
export async function setLocaleAction(form: FormData) {
  const locale = form.get("locale") === "bn" ? "bn" : "en";
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  const user = await currentUser();
  if (user) updateSettings(getTenantDb(user.accountId), (s) => ({ ...s, locale }));
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(input: Settings): Promise<ActionResult> {
  const { db } = await requireAccess();
  try {
    saveSettings(db, input);
    revalidatePath("/", "layout");
    return { ok: true, message: getDictionary(getSettings(db).locale).settings.saved };
  } catch (e) {
    return toActionError(e);
  }
}

function confirmed(form: FormData, word: string) {
  return String(form.get("confirm") ?? "").trim().toUpperCase() === word;
}

export async function loadDemoAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db } = await requireAccess();
  if (!confirmed(form, "DEMO")) return { ok: false, error: "Type DEMO to confirm." };
  seedDemoData(db);
  revalidatePath("/", "layout");
  redirect("/dashboard?demo=1");
}

export async function resetDataAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db } = await requireAccess();
  if (!confirmed(form, "RESET")) return { ok: false, error: "Type RESET to confirm." };
  resetBusinessData(db);
  revalidatePath("/", "layout");
  return { ok: true, message: getDictionary(getSettings(db).locale).settings.resetDone };
}

export async function restoreBackupAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db } = await requireAccess();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a backup file." };
  if (file.size > 50 * 1024 * 1024) return { ok: false, error: "Backup file is too large." };
  if (!confirmed(form, "RESTORE")) return { ok: false, error: "Type RESTORE to confirm." };
  try {
    const backup = JSON.parse(await file.text()) as Backup;
    restoreBackup(db, backup);
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, error: "That file is not valid JSON." };
    if (e instanceof Error && e.message.startsWith("Not a BizFlow")) return { ok: false, error: e.message };
    return toActionError(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: getDictionary(getSettings(db).locale).settings.restoreDone };
}
