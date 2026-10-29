"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { resetBusinessData, restoreBackup, type Backup } from "@/lib/services/data";
import { seedDemoData } from "@/lib/services/seed";
import { getSettings, saveSettings, updateSettings } from "@/lib/services/settings";
import { requireUser } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";
import { getDictionary } from "@/lib/i18n";
import type { Settings } from "@/lib/validation";

export async function setLocaleAction(form: FormData) {
  await requireUser();
  const locale = form.get("locale") === "bn" ? "bn" : "en";
  updateSettings(getDb(), (s) => ({ ...s, locale }));
  revalidatePath("/", "layout");
}

export async function saveSettingsAction(input: Settings): Promise<ActionResult> {
  await requireUser();
  try {
    const db = getDb();
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
  await requireUser();
  if (!confirmed(form, "DEMO")) return { ok: false, error: "Type DEMO to confirm." };
  seedDemoData(getDb());
  revalidatePath("/", "layout");
  redirect("/?demo=1");
}

export async function resetDataAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  if (!confirmed(form, "RESET")) return { ok: false, error: "Type RESET to confirm." };
  resetBusinessData(getDb());
  revalidatePath("/", "layout");
  return { ok: true, message: getDictionary(getSettings(getDb()).locale).settings.resetDone };
}

export async function restoreBackupAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a backup file." };
  if (file.size > 50 * 1024 * 1024) return { ok: false, error: "Backup file is too large." };
  if (!confirmed(form, "RESTORE")) return { ok: false, error: "Type RESTORE to confirm." };
  try {
    const backup = JSON.parse(await file.text()) as Backup;
    restoreBackup(getDb(), backup);
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, error: "That file is not valid JSON." };
    if (e instanceof Error && e.message.startsWith("Not a BizFlow")) return { ok: false, error: e.message };
    return toActionError(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: getDictionary(getSettings(getDb()).locale).settings.restoreDone };
}
