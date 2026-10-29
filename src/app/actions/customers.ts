"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/lib/services/customers";
import { requireUser } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";
import type { CustomerFormValues } from "@/lib/validation";

export async function saveCustomerAction(id: number | null, input: CustomerFormValues): Promise<ActionResult> {
  await requireUser();
  let savedId: number;
  try {
    const db = getDb();
    savedId = id ? updateCustomer(db, id, input as never).id : createCustomer(db, input as never).id;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/customers");
  redirect(`/customers/${savedId}`);
}

export async function archiveCustomerAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  setCustomerArchived(getDb(), id, form.get("archive") === "1");
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}
