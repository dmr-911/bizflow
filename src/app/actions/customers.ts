"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/lib/services/customers";
import { requireAccess } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";
import type { CustomerFormValues } from "@/lib/validation";

export async function saveCustomerAction(id: number | null, input: CustomerFormValues): Promise<ActionResult> {
  const { db } = await requireAccess();
  let savedId: number;
  try {
    savedId = id ? (await updateCustomer(db, id, input as never)).id : (await createCustomer(db, input as never)).id;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/customers");
  redirect(`/customers/${savedId}`);
}

export async function archiveCustomerAction(form: FormData) {
  const { db } = await requireAccess();
  const id = Number(form.get("id"));
  await setCustomerArchived(db, id, form.get("archive") === "1");
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
