"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import {
  cancelInvoice,
  convertQuotationToInvoice,
  createDocument,
  deleteDraftDocument,
  deletePayment,
  getDocument,
  markInvoiceSent,
  recordPayment,
  revertInvoiceToDraft,
  setQuotationStatus,
  updateDocument,
  type DocumentKind,
} from "@/lib/services/documents";
import { requireUser } from "@/lib/server/context";
import { toActionError, type ActionResult } from "@/lib/server/action";
import type { QuotationStatus } from "@/lib/status";
import type { DocumentFormValues } from "@/lib/validation";

const base = (kind: DocumentKind) => (kind === "invoice" ? "/invoices" : "/quotations");

function refresh(kind: DocumentKind, id?: number) {
  revalidatePath(base(kind));
  if (id) revalidatePath(`${base(kind)}/${id}`);
  revalidatePath("/");
}

export async function saveDocumentAction(kind: DocumentKind, id: number | null, input: DocumentFormValues): Promise<ActionResult> {
  await requireUser();
  let savedId: number;
  try {
    const db = getDb();
    savedId = id ? updateDocument(db, id, input).id : createDocument(db, kind, input).id;
  } catch (e) {
    return toActionError(e);
  }
  refresh(kind, savedId);
  redirect(`${base(kind)}/${savedId}`);
}

/**
 * Runs a lifecycle change from a plain <form> button. Errors come back as a
 * query parameter so these buttons work without client-side JavaScript.
 */
async function lifecycle(kind: DocumentKind, id: number, fn: () => number | void) {
  await requireUser();
  let target = `${base(kind)}/${id}`;
  try {
    const next = fn();
    if (typeof next === "number") target = `/invoices/${next}`;
  } catch (e) {
    const r = toActionError(e);
    redirect(`${target}?error=${encodeURIComponent(r.ok ? "" : r.error)}`);
  }
  refresh(kind, id);
  redirect(target);
}

export async function quotationStatusAction(form: FormData) {
  const id = Number(form.get("id"));
  const to = String(form.get("to")) as QuotationStatus;
  await lifecycle("quotation", id, () => void setQuotationStatus(getDb(), id, to));
}

export async function convertQuotationAction(form: FormData) {
  const id = Number(form.get("id"));
  await lifecycle("quotation", id, () => {
    const inv = convertQuotationToInvoice(getDb(), id, todayIso());
    revalidatePath("/invoices");
    return inv.id;
  });
}

export async function invoiceStatusAction(form: FormData) {
  const id = Number(form.get("id"));
  const to = String(form.get("to"));
  await lifecycle("invoice", id, () => {
    const db = getDb();
    if (to === "sent") markInvoiceSent(db, id);
    else if (to === "draft") revertInvoiceToDraft(db, id);
    else if (to === "cancelled") cancelInvoice(db, id);
  });
}

export async function deleteDraftAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  const db = getDb();
  const doc = getDocument(db, id);
  if (!doc) redirect("/");
  try {
    deleteDraftDocument(db, id);
  } catch (e) {
    const r = toActionError(e);
    redirect(`${base(doc.kind)}/${id}?error=${encodeURIComponent(r.ok ? "" : r.error)}`);
  }
  refresh(doc.kind);
  if (doc.sourceDocumentId) revalidatePath(`/quotations/${doc.sourceDocumentId}`);
  redirect(base(doc.kind));
}

export async function recordPaymentAction(invoiceId: number, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser();
  try {
    recordPayment(getDb(), invoiceId, Object.fromEntries(form));
  } catch (e) {
    return toActionError(e);
  }
  refresh("invoice", invoiceId);
  return { ok: true };
}

export async function deletePaymentAction(form: FormData) {
  const paymentId = Number(form.get("paymentId"));
  const invoiceId = Number(form.get("invoiceId"));
  await lifecycle("invoice", invoiceId, () => void deletePayment(getDb(), paymentId));
}
