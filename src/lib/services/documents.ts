import type { DB } from "../db";
import { nowIso } from "../db";
import { calculateDocument, type DiscountType, type LineInput } from "../calc";
import { formatMoney, type Currency } from "../money";
import { addDays, todayIso } from "../dates";
import { allocateDocumentNumber } from "../numbering";
import {
  applyPayment,
  assertCanCancelInvoice,
  assertCanRevertToDraft,
  assertInvoiceTransition,
  assertQuotationTransition,
  invoiceDisplayStatus,
  isInvoiceEditable,
  isQuotationEditable,
  quotationDisplayStatus,
  removePayment,
  TransitionError,
  type InvoiceDisplayStatus,
  type InvoiceStatus,
  type QuotationDisplayStatus,
  type QuotationStatus,
} from "../status";
import { documentSchema, paymentSchema, type DocumentInput, type PaymentInput, type TaxRate } from "../validation";
import { logActivity } from "./activity";
import { getCustomer, NotFoundError } from "./customers";
import { getSettings, saveSettings } from "./settings";

export type DocumentKind = "quotation" | "invoice";

export interface DocumentItem {
  id: number;
  position: number;
  description: string;
  quantityMilli: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  taxName: string;
  taxRateBps: number;
  lineTotal: number;
}

export interface DocumentRow {
  id: number;
  kind: DocumentKind;
  number: string;
  status: InvoiceStatus | QuotationStatus;
  displayStatus: InvoiceDisplayStatus | QuotationDisplayStatus;
  customerId: number;
  customerName: string;
  customerCompany: string;
  issueDate: string;
  dueDate: string | null;
  currency: Currency;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  notes: string;
  terms: string;
  sourceDocumentId: number | null;
  sentAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: number;
  invoiceId: number;
  amount: number;
  paidAt: string;
  method: string;
  reference: string;
  note: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentRow {
  items: DocumentItem[];
  payments: Payment[];
  /** For quotations: the invoice created from it. For invoices: the source quotation. */
  linked: { id: number; kind: DocumentKind; number: string } | null;
}

const SELECT = `
  SELECT d.id, d.kind, d.number, d.status, d.customer_id AS customerId, c.name AS customerName,
         c.company AS customerCompany, d.issue_date AS issueDate, d.due_date AS dueDate, d.currency,
         d.subtotal, d.discount_total AS discountTotal, d.tax_total AS taxTotal, d.total,
         d.amount_paid AS amountPaid, d.total - d.amount_paid AS balance, d.notes, d.terms,
         d.source_document_id AS sourceDocumentId, d.sent_at AS sentAt, d.paid_at AS paidAt,
         d.cancelled_at AS cancelledAt, d.created_at AS createdAt, d.updated_at AS updatedAt
  FROM documents d JOIN customers c ON c.id = d.customer_id`;

function withDisplay(row: Omit<DocumentRow, "displayStatus">, today: string): DocumentRow {
  const displayStatus =
    row.kind === "invoice"
      ? invoiceDisplayStatus({ status: row.status as InvoiceStatus, dueDate: row.dueDate }, today)
      : quotationDisplayStatus({ status: row.status as QuotationStatus, dueDate: row.dueDate }, today);
  return { ...row, displayStatus };
}

const label = (kind: DocumentKind) => (kind === "invoice" ? "Invoice" : "Quotation");

function resolveLines(
  items: DocumentInput["items"],
  taxRates: TaxRate[],
): (LineInput & { description: string; taxName: string })[] {
  return items.map((item) => {
    const rate = item.taxRateId ? taxRates.find((t) => t.id === item.taxRateId) : undefined;
    if (item.taxRateId && !rate) throw new TransitionError(`Unknown tax rate "${item.taxRateId}"`);
    return {
      description: item.description,
      quantityMilli: item.quantity,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxRateBps: rate?.rateBps ?? 0,
      taxName: rate && rate.rateBps > 0 ? rate.name : "",
    };
  });
}

function writeItems(db: DB, documentId: number, lines: ReturnType<typeof resolveLines>) {
  const totals = calculateDocument(lines);
  db.prepare("DELETE FROM document_items WHERE document_id = ?").run(documentId);
  const insert = db.prepare(
    `INSERT INTO document_items (document_id, position, description, quantity_milli, unit_price, discount_type,
       discount_value, tax_name, tax_rate_bps, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) =>
    insert.run(
      documentId,
      i,
      l.description,
      l.quantityMilli,
      l.unitPrice,
      l.discountType,
      l.discountValue,
      l.taxName,
      l.taxRateBps,
      totals.lines[i].total,
    ),
  );
  return totals;
}

function requireActiveCustomer(db: DB, customerId: number, allowArchivedId?: number) {
  const customer = getCustomer(db, customerId);
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt && customer.id !== allowArchivedId) {
    throw new TransitionError("Archived customers cannot receive new documents");
  }
  return customer;
}

export function nextDocumentNumber(db: DB, kind: DocumentKind, issueDate: string): string {
  const settings = getSettings(db);
  const cfg = kind === "invoice" ? settings.invoiceNumbering : settings.quotationNumbering;
  const taken = db.prepare("SELECT 1 FROM documents WHERE kind = ? AND number = ?");
  const { number, next } = allocateDocumentNumber(cfg, Number(issueDate.slice(0, 4)), (n) => !!taken.get(kind, n));
  if (kind === "invoice") settings.invoiceNumbering.next = next;
  else settings.quotationNumbering.next = next;
  saveSettings(db, settings);
  return number;
}

export function createDocument(
  db: DB,
  kind: DocumentKind,
  raw: unknown,
  opts: { sourceDocumentId?: number } = {},
): DocumentDetail {
  const input = documentSchema.parse(raw);
  return db.transaction(() => {
    const customer = requireActiveCustomer(db, input.customerId);
    const settings = getSettings(db);
    const lines = resolveLines(input.items, settings.taxRates);
    const number = nextDocumentNumber(db, kind, input.issueDate);
    const now = nowIso();
    const res = db
      .prepare(
        `INSERT INTO documents (kind, number, status, customer_id, issue_date, due_date, currency, notes, terms,
           source_document_id, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        kind,
        number,
        customer.id,
        input.issueDate,
        input.dueDate,
        input.currency,
        input.notes,
        input.terms,
        opts.sourceDocumentId ?? null,
        now,
        now,
      );
    const id = Number(res.lastInsertRowid);
    const totals = writeItems(db, id, lines);
    db.prepare("UPDATE documents SET subtotal=?, discount_total=?, tax_total=?, total=? WHERE id=?").run(
      totals.subtotal,
      totals.discountTotal,
      totals.taxTotal,
      totals.total,
      id,
    );
    logActivity(db, {
      type: `${kind}.created`,
      message: `${label(kind)} ${number} created for ${customer.name} (${formatMoney(totals.total, input.currency)})`,
      customerId: customer.id,
      documentId: id,
    });
    return getDocument(db, id)!;
  })();
}

export function updateDocument(db: DB, id: number, raw: unknown): DocumentDetail {
  const input = documentSchema.parse(raw);
  return db.transaction(() => {
    const doc = getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    const editable =
      doc.kind === "invoice"
        ? isInvoiceEditable(doc.status as InvoiceStatus)
        : isQuotationEditable(doc.status as QuotationStatus);
    if (!editable) throw new TransitionError(`This ${doc.kind} can no longer be edited`);
    const customer = requireActiveCustomer(db, input.customerId, doc.customerId);
    const lines = resolveLines(input.items, getSettings(db).taxRates);
    const totals = writeItems(db, id, lines);
    db.prepare(
      `UPDATE documents SET customer_id=?, issue_date=?, due_date=?, currency=?, notes=?, terms=?,
         subtotal=?, discount_total=?, tax_total=?, total=?, updated_at=? WHERE id=?`,
    ).run(
      customer.id,
      input.issueDate,
      input.dueDate,
      input.currency,
      input.notes,
      input.terms,
      totals.subtotal,
      totals.discountTotal,
      totals.taxTotal,
      totals.total,
      nowIso(),
      id,
    );
    logActivity(db, {
      type: `${doc.kind}.updated`,
      message: `${label(doc.kind)} ${doc.number} updated`,
      customerId: customer.id,
      documentId: id,
    });
    return getDocument(db, id)!;
  })();
}

export function getDocument(db: DB, id: number, today: string = todayIso()): DocumentDetail | null {
  const row = db.prepare(`${SELECT} WHERE d.id = ?`).get(id) as Omit<DocumentRow, "displayStatus"> | undefined;
  if (!row) return null;
  const items = db
    .prepare(
      `SELECT id, position, description, quantity_milli AS quantityMilli, unit_price AS unitPrice,
              discount_type AS discountType, discount_value AS discountValue, tax_name AS taxName,
              tax_rate_bps AS taxRateBps, line_total AS lineTotal
       FROM document_items WHERE document_id = ? ORDER BY position`,
    )
    .all(id) as DocumentItem[];
  const payments =
    row.kind === "invoice"
      ? (db
          .prepare(
            `SELECT id, invoice_id AS invoiceId, amount, paid_at AS paidAt, method, reference, note, created_at AS createdAt
             FROM payments WHERE invoice_id = ? ORDER BY paid_at, id`,
          )
          .all(id) as Payment[])
      : [];
  const linked =
    row.kind === "invoice"
      ? row.sourceDocumentId
        ? ((db.prepare("SELECT id, kind, number FROM documents WHERE id = ?").get(row.sourceDocumentId) as DocumentDetail["linked"]) ?? null)
        : null
      : ((db
          .prepare("SELECT id, kind, number FROM documents WHERE source_document_id = ?")
          .get(id) as DocumentDetail["linked"]) ?? null);
  return { ...withDisplay(row, today), items, payments, linked };
}

export interface DocumentFilter {
  status?: string;
  customerId?: number;
  search?: string;
}

export function listDocuments(
  db: DB,
  kind: DocumentKind,
  filter: DocumentFilter = {},
  today: string = todayIso(),
): DocumentRow[] {
  const where = ["d.kind = @kind"];
  const params: Record<string, unknown> = { kind };
  if (filter.customerId) {
    where.push("d.customer_id = @customerId");
    params.customerId = filter.customerId;
  }
  if (filter.search?.trim()) {
    where.push("(d.number LIKE @q OR c.name LIKE @q OR c.company LIKE @q)");
    params.q = `%${filter.search.trim()}%`;
  }
  const rows = (
    db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.issue_date DESC, d.id DESC`).all(params) as Omit<
      DocumentRow,
      "displayStatus"
    >[]
  ).map((r) => withDisplay(r, today));
  if (!filter.status || filter.status === "all") return rows;
  if (filter.status === "unpaid") return rows.filter((r) => ["sent", "partially_paid", "overdue"].includes(r.displayStatus));
  return rows.filter((r) => r.displayStatus === filter.status);
}

function requireDoc(db: DB, id: number, kind: DocumentKind): DocumentDetail {
  const doc = getDocument(db, id);
  if (!doc || doc.kind !== kind) throw new NotFoundError(label(kind));
  return doc;
}

// ---------- Quotation lifecycle ----------

export function setQuotationStatus(db: DB, id: number, to: QuotationStatus): DocumentDetail {
  if (to === "converted") throw new TransitionError("Use convert to invoice instead");
  return db.transaction(() => {
    const q = requireDoc(db, id, "quotation");
    assertQuotationTransition(q.status as QuotationStatus, to);
    db.prepare(
      `UPDATE documents SET status = ?, sent_at = COALESCE(sent_at, CASE WHEN ? = 'sent' THEN ? END), updated_at = ? WHERE id = ?`,
    ).run(to, to, nowIso(), nowIso(), id);
    logActivity(db, {
      type: `quotation.${to}`,
      message: `Quotation ${q.number} marked ${to}`,
      customerId: q.customerId,
      documentId: id,
    });
    return getDocument(db, id)!;
  })();
}

/**
 * Create a draft invoice from an accepted quotation. A partial unique index
 * guarantees a quotation can only ever produce one invoice.
 */
export function convertQuotationToInvoice(db: DB, quotationId: number, issueDate: string): DocumentDetail {
  return db.transaction(() => {
    const q = requireDoc(db, quotationId, "quotation");
    if (q.status !== "accepted") throw new TransitionError("Only accepted quotations can be converted to invoices");
    if (q.linked) throw new TransitionError(`Already converted to invoice ${q.linked.number}`);
    const settings = getSettings(db);
    const dueDate = addDays(issueDate, settings.paymentTermsDays);
    const invoice = createInsertFromItems(db, q, issueDate, dueDate, settings.invoiceTerms);
    assertQuotationTransition("accepted", "converted");
    db.prepare("UPDATE documents SET status = 'converted', updated_at = ? WHERE id = ?").run(nowIso(), quotationId);
    logActivity(db, {
      type: "quotation.converted",
      message: `Quotation ${q.number} converted to invoice ${invoice.number}`,
      customerId: q.customerId,
      documentId: quotationId,
    });
    return invoice;
  })();
}

/** Copies quotation lines verbatim (including the tax snapshot) into a new invoice. */
function createInsertFromItems(
  db: DB,
  q: DocumentDetail,
  issueDate: string,
  dueDate: string,
  terms: string,
): DocumentDetail {
  const number = nextDocumentNumber(db, "invoice", issueDate);
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO documents (kind, number, status, customer_id, issue_date, due_date, currency, subtotal,
         discount_total, tax_total, total, notes, terms, source_document_id, created_at, updated_at)
       VALUES ('invoice', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(number, q.customerId, issueDate, dueDate, q.currency, q.subtotal, q.discountTotal, q.taxTotal, q.total, q.notes, terms, q.id, now, now);
  const id = Number(res.lastInsertRowid);
  const lines = q.items.map((i) => ({ ...i }));
  const totals = writeItems(db, id, lines);
  if (totals.total !== q.total) throw new Error("Converted totals do not match the quotation");
  logActivity(db, {
    type: "invoice.created",
    message: `Invoice ${number} created from quotation ${q.number} (${formatMoney(q.total, q.currency)})`,
    customerId: q.customerId,
    documentId: id,
  });
  return getDocument(db, id)!;
}

// ---------- Invoice lifecycle ----------

export function markInvoiceSent(db: DB, id: number): DocumentDetail {
  return db.transaction(() => {
    const inv = requireDoc(db, id, "invoice");
    if (inv.total <= 0) throw new TransitionError("An invoice must have a total greater than zero");
    assertInvoiceTransition(inv.status as InvoiceStatus, "sent");
    db.prepare("UPDATE documents SET status='sent', sent_at=COALESCE(sent_at, ?), updated_at=? WHERE id=?").run(
      nowIso(),
      nowIso(),
      id,
    );
    logActivity(db, { type: "invoice.sent", message: `Invoice ${inv.number} marked as sent`, customerId: inv.customerId, documentId: id });
    return getDocument(db, id)!;
  })();
}

export function revertInvoiceToDraft(db: DB, id: number): DocumentDetail {
  return db.transaction(() => {
    const inv = requireDoc(db, id, "invoice");
    assertCanRevertToDraft({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    db.prepare("UPDATE documents SET status='draft', updated_at=? WHERE id=?").run(nowIso(), id);
    logActivity(db, { type: "invoice.draft", message: `Invoice ${inv.number} moved back to draft`, customerId: inv.customerId, documentId: id });
    return getDocument(db, id)!;
  })();
}

export function cancelInvoice(db: DB, id: number): DocumentDetail {
  return db.transaction(() => {
    const inv = requireDoc(db, id, "invoice");
    assertCanCancelInvoice({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    db.prepare("UPDATE documents SET status='cancelled', cancelled_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), id);
    logActivity(db, { type: "invoice.cancelled", message: `Invoice ${inv.number} cancelled`, customerId: inv.customerId, documentId: id });
    return getDocument(db, id)!;
  })();
}

export function recordPayment(db: DB, invoiceId: number, raw: unknown): Payment {
  const input: PaymentInput = paymentSchema.parse(raw);
  return db.transaction(() => {
    const inv = requireDoc(db, invoiceId, "invoice");
    const next = applyPayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, input.amount);
    const res = db
      .prepare(
        `INSERT INTO payments (invoice_id, amount, paid_at, method, reference, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(invoiceId, input.amount, input.paidAt, input.method, input.reference, input.note, nowIso());
    db.prepare("UPDATE documents SET amount_paid=?, status=?, paid_at=?, updated_at=? WHERE id=?").run(
      next.amountPaid,
      next.status,
      next.status === "paid" ? input.paidAt : null,
      nowIso(),
      invoiceId,
    );
    logActivity(db, {
      type: "payment.recorded",
      message: `Payment of ${formatMoney(input.amount, inv.currency)} received for ${inv.number}${next.status === "paid" ? " (paid in full)" : ""}`,
      customerId: inv.customerId,
      documentId: invoiceId,
    });
    return db
      .prepare(
        `SELECT id, invoice_id AS invoiceId, amount, paid_at AS paidAt, method, reference, note, created_at AS createdAt FROM payments WHERE id = ?`,
      )
      .get(Number(res.lastInsertRowid)) as Payment;
  })();
}

export function deletePayment(db: DB, paymentId: number): DocumentDetail {
  return db.transaction(() => {
    const p = db.prepare("SELECT id, invoice_id AS invoiceId, amount FROM payments WHERE id = ?").get(paymentId) as
      | { id: number; invoiceId: number; amount: number }
      | undefined;
    if (!p) throw new NotFoundError("Payment");
    const inv = requireDoc(db, p.invoiceId, "invoice");
    const next = removePayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, p.amount);
    db.prepare("DELETE FROM payments WHERE id = ?").run(paymentId);
    db.prepare("UPDATE documents SET amount_paid=?, status=?, paid_at=NULL, updated_at=? WHERE id=?").run(
      next.amountPaid,
      next.status,
      nowIso(),
      inv.id,
    );
    logActivity(db, {
      type: "payment.removed",
      message: `Payment of ${formatMoney(p.amount, inv.currency)} removed from ${inv.number}`,
      customerId: inv.customerId,
      documentId: inv.id,
    });
    return getDocument(db, inv.id)!;
  })();
}

/** Only drafts with no payments or linked documents can be deleted. Issued documents are cancelled instead. */
export function deleteDraftDocument(db: DB, id: number): void {
  db.transaction(() => {
    const doc = getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    if (doc.status !== "draft") throw new TransitionError("Only drafts can be deleted");
    if (doc.linked && doc.kind === "quotation") throw new TransitionError("This quotation has an invoice");
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    if (doc.kind === "invoice" && doc.sourceDocumentId) {
      // Deleting the draft invoice re-opens the quotation it came from.
      db.prepare("UPDATE documents SET status = 'accepted', updated_at = ? WHERE id = ? AND status = 'converted'").run(
        nowIso(),
        doc.sourceDocumentId,
      );
    }
    logActivity(db, { type: `${doc.kind}.deleted`, message: `${label(doc.kind)} draft ${doc.number} deleted`, customerId: doc.customerId });
  })();
}
