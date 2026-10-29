/**
 * Invoice and quotation lifecycles.
 *
 * Stored statuses are the ones a user moves a document through. "overdue"
 * (invoices) and "expired" (quotations) are derived from dates at read time,
 * so they never go stale and never need a background job.
 */

export const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceDisplayStatus = InvoiceStatus | "overdue";

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "converted"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export type QuotationDisplayStatus = QuotationStatus | "expired";

const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["partially_paid", "paid", "cancelled", "draft"],
  partially_paid: ["partially_paid", "paid", "sent"],
  paid: ["partially_paid", "sent"],
  cancelled: [],
};

const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent", "accepted", "rejected"],
  sent: ["accepted", "rejected", "draft"],
  accepted: ["converted", "rejected"],
  rejected: ["draft"],
  converted: [],
};

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransitionInvoice(from, to)) {
    throw new TransitionError(`Invoice cannot move from "${from}" to "${to}"`);
  }
}

export function canTransitionQuotation(from: QuotationStatus, to: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[from].includes(to);
}

export function assertQuotationTransition(from: QuotationStatus, to: QuotationStatus): void {
  if (!canTransitionQuotation(from, to)) {
    throw new TransitionError(`Quotation cannot move from "${from}" to "${to}"`);
  }
}

/** Status an issued invoice should have for a given amount paid. */
export function statusForPaidAmount(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partially_paid";
}

/**
 * Validate a payment against the invoice and return the resulting status.
 * Payments are only accepted on issued, unpaid invoices and may not exceed the balance.
 */
export function applyPayment(
  invoice: { status: InvoiceStatus; total: number; amountPaid: number },
  amount: number,
): { status: InvoiceStatus; amountPaid: number } {
  if (!Number.isInteger(amount) || amount <= 0) throw new TransitionError("Payment amount must be greater than zero");
  if (invoice.status === "draft") throw new TransitionError("Mark the invoice as sent before recording a payment");
  if (invoice.status === "cancelled") throw new TransitionError("Cannot record a payment on a cancelled invoice");
  if (invoice.status === "paid") throw new TransitionError("Invoice is already fully paid");
  const balance = invoice.total - invoice.amountPaid;
  if (amount > balance) throw new TransitionError("Payment exceeds the outstanding balance");
  const amountPaid = invoice.amountPaid + amount;
  const status = statusForPaidAmount(invoice.total, amountPaid);
  assertInvoiceTransition(invoice.status, status);
  return { status, amountPaid };
}

/** Reverse a recorded payment (e.g. entered by mistake). */
export function removePayment(
  invoice: { status: InvoiceStatus; total: number; amountPaid: number },
  amount: number,
): { status: InvoiceStatus; amountPaid: number } {
  if (invoice.status === "cancelled") throw new TransitionError("Cannot change payments on a cancelled invoice");
  const amountPaid = invoice.amountPaid - amount;
  if (amountPaid < 0) throw new TransitionError("Payment total cannot go below zero");
  const status = statusForPaidAmount(invoice.total, amountPaid);
  if (status !== invoice.status) assertInvoiceTransition(invoice.status, status);
  return { status, amountPaid };
}

/** Cancelling is only allowed while nothing has been paid; refund first otherwise. */
export function assertCanCancelInvoice(invoice: { status: InvoiceStatus; amountPaid: number }): void {
  if (invoice.amountPaid > 0) throw new TransitionError("Remove recorded payments before cancelling this invoice");
  assertInvoiceTransition(invoice.status, "cancelled");
}

/** Moving a sent invoice back to draft is only safe before any payment. */
export function assertCanRevertToDraft(invoice: { status: InvoiceStatus; amountPaid: number }): void {
  if (invoice.amountPaid > 0) throw new TransitionError("Invoices with payments cannot return to draft");
  assertInvoiceTransition(invoice.status, "draft");
}

export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === "draft";
}

export function isQuotationEditable(status: QuotationStatus): boolean {
  return status === "draft" || status === "sent";
}

/** today and dueDate are ISO dates (YYYY-MM-DD), so string comparison is chronological. */
export function invoiceDisplayStatus(
  invoice: { status: InvoiceStatus; dueDate: string | null },
  today: string,
): InvoiceDisplayStatus {
  if ((invoice.status === "sent" || invoice.status === "partially_paid") && invoice.dueDate && invoice.dueDate < today) {
    return "overdue";
  }
  return invoice.status;
}

export function quotationDisplayStatus(
  quotation: { status: QuotationStatus; dueDate: string | null },
  today: string,
): QuotationDisplayStatus {
  if ((quotation.status === "sent" || quotation.status === "draft") && quotation.dueDate && quotation.dueDate < today) {
    return "expired";
  }
  return quotation.status;
}
