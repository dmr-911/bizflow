"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { createFollowUp, deleteFollowUp, setFollowUpCompleted } from "@/lib/services/followups";
import { requireUser } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";

function refresh() {
  revalidatePath("/", "layout");
}

export async function createFollowUpAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  try {
    createFollowUp(getDb(), Object.fromEntries(form));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function toggleFollowUpAction(form: FormData) {
  await requireUser();
  setFollowUpCompleted(getDb(), Number(form.get("id")), form.get("completed") === "1");
  refresh();
}

export async function deleteFollowUpAction(form: FormData) {
  await requireUser();
  deleteFollowUp(getDb(), Number(form.get("id")));
  refresh();
}
