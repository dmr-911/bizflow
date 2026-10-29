"use server";

import { revalidatePath } from "next/cache";
import { createFollowUp, deleteFollowUp, setFollowUpCompleted } from "@/lib/services/followups";
import { requireAccess } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";

function refresh() {
  revalidatePath("/", "layout");
}

export async function createFollowUpAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const { db } = await requireAccess();
  try {
    await createFollowUp(db, Object.fromEntries(form));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function toggleFollowUpAction(form: FormData) {
  const { db } = await requireAccess();
  await setFollowUpCompleted(db, Number(form.get("id")), form.get("completed") === "1");
  refresh();
}

export async function deleteFollowUpAction(form: FormData) {
  const { db } = await requireAccess();
  await deleteFollowUp(db, Number(form.get("id")));
  refresh();
}
