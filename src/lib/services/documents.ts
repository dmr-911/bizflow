import type { TenantDb } from "../db";
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
  SELECT d.id, d.kind, d.number, d.status, d.customer_id AS "customerId", c.name AS "customerName",
         c.company AS "customerCompany", d.issue_date AS "issueDate", d.due_date AS "dueDate", d.currency,
         d.subtotal, d.discount_total AS "discountTotal", d.tax_total AS "taxTotal", d.total,
         d.amount_paid AS "amountPaid", d.total - d.amount_paid AS balance, d.notes, d.terms,
         d.source_document_id AS "sourceDocumentId", d.sent_at AS "sentAt", d.paid_at AS "paidAt",
         d.cancelled_at AS "cancelledAt", d.created_at AS "createdAt", d.updated_at AS "updatedAt"
  FROM documents d JOIN customers c ON c.account_id = d.account_id AND c.id = d.customer_id`;

const PAYMENT_COLUMNS = `id, invoice_id AS "invoiceId", amount, paid_at AS "paidAt", method, reference, note, created_at AS "createdAt"`;

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

async function writeItems(db: TenantDb, documentId: number, lines: ReturnType<typeof resolveLines>) {
  const totals = calculateDocument(lines);
  await db.run("DELETE FROM document_items WHERE account_id = $1 AND document_id = $2", db.accountId, documentId);
  if (lines.length === 0) return totals;
  // One multi-row insert: each round trip to a hosted database costs a few milliseconds.
  const params: unknown[] = [db.accountId, documentId];
  const rows = lines.map((l, i) => {
    const values = [i, l.description, l.quantityMilli, l.unitPrice, l.discountType, l.discountValue, l.taxName, l.taxRateBps, totals.lines[i].total];
    const placeholders = values.map((v) => `$${params.push(v)}`);
    return `($1, $2, ${placeholders.join(", ")})`;
  });
  await db.run(
    `INSERT INTO document_items (account_id, document_id, position, description, quantity_milli, unit_price, discount_type,
       discount_value, tax_name, tax_rate_bps, line_total)
     VALUES ${rows.join(", ")}`,
    ...params,
  );
  return totals;
}

async function requireActiveCustomer(db: TenantDb, customerId: number, allowArchivedId?: number) {
  const customer = await getCustomer(db, customerId);
  if (!customer) throw new NotFoundError("Customer");
  if (customer.archivedAt && customer.id !== allowArchivedId) {
    throw new TransitionError("Archived customers cannot receive new documents");
  }
  return customer;
}

/** Call inside a transaction: it reads and then advances the counter in settings. */
export async function nextDocumentNumber(db: TenantDb, kind: DocumentKind, issueDate: string): Promise<string> {
  const settings = await getSettings(db);
  const cfg = kind === "invoice" ? settings.invoiceNumbering : settings.quotationNumbering;
  const taken = new Set(
    (await db.all<{ number: string }>("SELECT number FROM documents WHERE account_id = $1 AND kind = $2", db.accountId, kind)).map(
      (r) => r.number,
    ),
  );
  const { number, next } = allocateDocumentNumber(cfg, Number(issueDate.slice(0, 4)), (n) => taken.has(n));
  if (kind === "invoice") settings.invoiceNumbering.next = next;
  else settings.quotationNumbering.next = next;
  await saveSettings(db, settings);
  return number;
}

export async function createDocument(
  db: TenantDb,
  kind: DocumentKind,
  raw: unknown,
  opts: { sourceDocumentId?: number } = {},
): Promise<DocumentDetail> {
  const input = documentSchema.parse(raw);
  return db.tx(async (db) => {
    const customer = await requireActiveCustomer(db, input.customerId);
    const settings = await getSettings(db);
    const lines = resolveLines(input.items, settings.taxRates);
    const number = await nextDocumentNumber(db, kind, input.issueDate);
    const now = nowIso();
    const totals = calculateDocument(lines);
    const { id } = (await db.get<{ id: number }>(
      `INSERT INTO documents (account_id, kind, number, status, customer_id, issue_date, due_date, currency, notes, terms,
         source_document_id, subtotal, discount_total, tax_total, total, created_at, updated_at)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id`,
      db.accountId,
      kind,
      number,
      customer.id,
      input.issueDate,
      input.dueDate,
      input.currency,
      input.notes,
      input.terms,
      opts.sourceDocumentId ?? null,
      totals.subtotal,
      totals.discountTotal,
      totals.taxTotal,
      totals.total,
      now,
    ))!;
    await writeItems(db, id, lines);
    await logActivity(db, {
      type: `${kind}.created`,
      message: `${label(kind)} ${number} created for ${customer.name} (${formatMoney(totals.total, input.currency)})`,
      customerId: customer.id,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

export async function updateDocument(db: TenantDb, id: number, raw: unknown): Promise<DocumentDetail> {
  const input = documentSchema.parse(raw);
  return db.tx(async (db) => {
    const doc = await getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    const editable =
      doc.kind === "invoice"
        ? isInvoiceEditable(doc.status as InvoiceStatus)
        : isQuotationEditable(doc.status as QuotationStatus);
    if (!editable) throw new TransitionError(`This ${doc.kind} can no longer be edited`);
    const customer = await requireActiveCustomer(db, input.customerId, doc.customerId);
    const lines = resolveLines(input.items, (await getSettings(db)).taxRates);
    const totals = await writeItems(db, id, lines);
    await db.run(
      `UPDATE documents SET customer_id = $3, issue_date = $4, due_date = $5, currency = $6, notes = $7, terms = $8,
         subtotal = $9, discount_total = $10, tax_total = $11, total = $12, updated_at = $13 WHERE account_id = $1 AND id = $2`,
      db.accountId,
      id,
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
    );
    await logActivity(db, {
      type: `${doc.kind}.updated`,
      message: `${label(doc.kind)} ${doc.number} updated`,
      customerId: customer.id,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

export async function getDocument(db: TenantDb, id: number, today: string = todayIso()): Promise<DocumentDetail | null> {
  const row = await db.get<Omit<DocumentRow, "displayStatus">>(`${SELECT} WHERE d.account_id = $1 AND d.id = $2`, db.accountId, id);
  if (!row) return null;
  const [items, payments, linked] = await Promise.all([
    db.all<DocumentItem>(
      `SELECT id, position, description, quantity_milli AS "quantityMilli", unit_price AS "unitPrice",
              discount_type AS "discountType", discount_value AS "discountValue", tax_name AS "taxName",
              tax_rate_bps AS "taxRateBps", line_total AS "lineTotal"
       FROM document_items WHERE account_id = $1 AND document_id = $2 ORDER BY position`,
      db.accountId,
      id,
    ),
    row.kind === "invoice"
      ? db.all<Payment>(
          `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE account_id = $1 AND invoice_id = $2 ORDER BY paid_at, id`,
          db.accountId,
          id,
        )
      : Promise.resolve([] as Payment[]),
    row.kind === "invoice"
      ? row.sourceDocumentId
        ? db.get<NonNullable<DocumentDetail["linked"]>>(
            "SELECT id, kind, number FROM documents WHERE account_id = $1 AND id = $2",
            db.accountId,
            row.sourceDocumentId,
          )
        : Promise.resolve(undefined)
      : db.get<NonNullable<DocumentDetail["linked"]>>(
          "SELECT id, kind, number FROM documents WHERE account_id = $1 AND source_document_id = $2",
          db.accountId,
          id,
        ),
  ]);
  return { ...withDisplay(row, today), items, payments, linked: linked ?? null };
}

export interface DocumentFilter {
  status?: string;
  customerId?: number;
  search?: string;
}

export async function listDocuments(
  db: TenantDb,
  kind: DocumentKind,
  filter: DocumentFilter = {},
  today: string = todayIso(),
): Promise<DocumentRow[]> {
  const where = ["d.account_id = $1", "d.kind = $2"];
  const params: unknown[] = [db.accountId, kind];
  if (filter.customerId) {
    params.push(filter.customerId);
    where.push(`d.customer_id = $${params.length}`);
  }
  if (filter.search?.trim()) {
    params.push(`%${filter.search.trim()}%`);
    const q = `$${params.length}`;
    where.push(`(d.number ILIKE ${q} OR c.name ILIKE ${q} OR c.company ILIKE ${q})`);
  }
  const rows = (
    await db.all<Omit<DocumentRow, "displayStatus">>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.issue_date DESC, d.id DESC`, ...params)
  ).map((r) => withDisplay(r, today));
  if (!filter.status || filter.status === "all") return rows;
  if (filter.status === "unpaid") return rows.filter((r) => ["sent", "partially_paid", "overdue"].includes(r.displayStatus));
  return rows.filter((r) => r.displayStatus === filter.status);
}

async function requireDoc(db: TenantDb, id: number, kind: DocumentKind): Promise<DocumentDetail> {
  const doc = await getDocument(db, id);
  if (!doc || doc.kind !== kind) throw new NotFoundError(label(kind));
  return doc;
}

// ---------- Quotation lifecycle ----------

export async function setQuotationStatus(db: TenantDb, id: number, to: QuotationStatus): Promise<DocumentDetail> {
  if (to === "converted") throw new TransitionError("Use convert to invoice instead");
  return db.tx(async (db) => {
    const q = await requireDoc(db, id, "quotation");
    assertQuotationTransition(q.status as QuotationStatus, to);
    const now = nowIso();
    await db.run(
      "UPDATE documents SET status = $3, sent_at = COALESCE(sent_at, $4), updated_at = $5 WHERE account_id = $1 AND id = $2",
      db.accountId,
      id,
      to,
      to === "sent" ? now : null,
      now,
    );
    await logActivity(db, {
      type: `quotation.${to}`,
      message: `Quotation ${q.number} marked ${to}`,
      customerId: q.customerId,
      documentId: id,
    });
    return (await getDocument(db, id))!;
  });
}

/**
 * Create a draft invoice from an accepted quotation. A partial unique index
 * guarantees a quotation can only ever produce one invoice.
 */
export async function convertQuotationToInvoice(db: TenantDb, quotationId: number, issueDate: string): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const q = await requireDoc(db, quotationId, "quotation");
    if (q.status !== "accepted") throw new TransitionError("Only accepted quotations can be converted to invoices");
    if (q.linked) throw new TransitionError(`Already converted to invoice ${q.linked.number}`);
    const settings = await getSettings(db);
    const dueDate = addDays(issueDate, settings.paymentTermsDays);
    const invoice = await createInsertFromItems(db, q, issueDate, dueDate, settings.invoiceTerms);
    assertQuotationTransition("accepted", "converted");
    await db.run("UPDATE documents SET status = 'converted', updated_at = $3 WHERE account_id = $1 AND id = $2", db.accountId, quotationId, nowIso());
    await logActivity(db, {
      type: "quotation.converted",
      message: `Quotation ${q.number} converted to invoice ${invoice.number}`,
      customerId: q.customerId,
      documentId: quotationId,
    });
    return invoice;
  });
}

/** Copies quotation lines verbatim (including the tax snapshot) into a new invoice. */
async function createInsertFromItems(
  db: TenantDb,
  q: DocumentDetail,
  issueDate: string,
  dueDate: string,
  terms: string,
): Promise<DocumentDetail> {
  const number = await nextDocumentNumber(db, "invoice", issueDate);
  const now = nowIso();
  const { id } = (await db.get<{ id: number }>(
    `INSERT INTO documents (account_id, kind, number, status, customer_id, issue_date, due_date, currency, subtotal,
       discount_total, tax_total, total, notes, terms, source_document_id, created_at, updated_at)
     VALUES ($1, 'invoice', $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING id`,
    db.accountId,
    number,
    q.customerId,
    issueDate,
    dueDate,
    q.currency,
    q.subtotal,
    q.discountTotal,
    q.taxTotal,
    q.total,
    q.notes,
    terms,
    q.id,
    now,
  ))!;
  const lines = q.items.map((i) => ({ ...i }));
  const totals = await writeItems(db, id, lines);
  if (totals.total !== q.total) throw new Error("Converted totals do not match the quotation");
  await logActivity(db, {
    type: "invoice.created",
    message: `Invoice ${number} created from quotation ${q.number} (${formatMoney(q.total, q.currency)})`,
    customerId: q.customerId,
    documentId: id,
  });
  return (await getDocument(db, id))!;
}

// ---------- Invoice lifecycle ----------

export async function markInvoiceSent(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    if (inv.total <= 0) throw new TransitionError("An invoice must have a total greater than zero");
    assertInvoiceTransition(inv.status as InvoiceStatus, "sent");
    const now = nowIso();
    await db.run(
      "UPDATE documents SET status = 'sent', sent_at = COALESCE(sent_at, $3), updated_at = $3 WHERE account_id = $1 AND id = $2",
      db.accountId,
      id,
      now,
    );
    await logActivity(db, { type: "invoice.sent", message: `Invoice ${inv.number} marked as sent`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function revertInvoiceToDraft(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    assertCanRevertToDraft({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    await db.run("UPDATE documents SET status = 'draft', updated_at = $3 WHERE account_id = $1 AND id = $2", db.accountId, id, nowIso());
    await logActivity(db, { type: "invoice.draft", message: `Invoice ${inv.number} moved back to draft`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function cancelInvoice(db: TenantDb, id: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const inv = await requireDoc(db, id, "invoice");
    assertCanCancelInvoice({ status: inv.status as InvoiceStatus, amountPaid: inv.amountPaid });
    const now = nowIso();
    await db.run(
      "UPDATE documents SET status = 'cancelled', cancelled_at = $3, updated_at = $3 WHERE account_id = $1 AND id = $2",
      db.accountId,
      id,
      now,
    );
    await logActivity(db, { type: "invoice.cancelled", message: `Invoice ${inv.number} cancelled`, customerId: inv.customerId, documentId: id });
    return (await getDocument(db, id))!;
  });
}

export async function recordPayment(db: TenantDb, invoiceId: number, raw: unknown): Promise<Payment> {
  const input: PaymentInput = paymentSchema.parse(raw);
  return db.tx(async (db) => {
    const inv = await requireDoc(db, invoiceId, "invoice");
    const next = applyPayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, input.amount);
    const payment = (await db.get<Payment>(
      `INSERT INTO payments (account_id, invoice_id, amount, paid_at, method, reference, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PAYMENT_COLUMNS}`,
      db.accountId,
      invoiceId,
      input.amount,
      input.paidAt,
      input.method,
      input.reference,
      input.note,
      nowIso(),
    ))!;
    await db.run(
      "UPDATE documents SET amount_paid = $3, status = $4, paid_at = $5, updated_at = $6 WHERE account_id = $1 AND id = $2",
      db.accountId,
      invoiceId,
      next.amountPaid,
      next.status,
      next.status === "paid" ? input.paidAt : null,
      nowIso(),
    );
    await logActivity(db, {
      type: "payment.recorded",
      message: `Payment of ${formatMoney(input.amount, inv.currency)} received for ${inv.number}${next.status === "paid" ? " (paid in full)" : ""}`,
      customerId: inv.customerId,
      documentId: invoiceId,
    });
    return payment;
  });
}

export async function deletePayment(db: TenantDb, paymentId: number): Promise<DocumentDetail> {
  return db.tx(async (db) => {
    const p = await db.get<{ id: number; invoiceId: number; amount: number }>(
      `SELECT id, invoice_id AS "invoiceId", amount FROM payments WHERE account_id = $1 AND id = $2`,
      db.accountId,
      paymentId,
    );
    if (!p) throw new NotFoundError("Payment");
    const inv = await requireDoc(db, p.invoiceId, "invoice");
    const next = removePayment({ status: inv.status as InvoiceStatus, total: inv.total, amountPaid: inv.amountPaid }, p.amount);
    await db.run("DELETE FROM payments WHERE account_id = $1 AND id = $2", db.accountId, paymentId);
    await db.run(
      "UPDATE documents SET amount_paid = $3, status = $4, paid_at = NULL, updated_at = $5 WHERE account_id = $1 AND id = $2",
      db.accountId,
      inv.id,
      next.amountPaid,
      next.status,
      nowIso(),
    );
    await logActivity(db, {
      type: "payment.removed",
      message: `Payment of ${formatMoney(p.amount, inv.currency)} removed from ${inv.number}`,
      customerId: inv.customerId,
      documentId: inv.id,
    });
    return (await getDocument(db, inv.id))!;
  });
}

/** Only drafts with no payments or linked documents can be deleted. Issued documents are cancelled instead. */
export async function deleteDraftDocument(db: TenantDb, id: number): Promise<void> {
  await db.tx(async (db) => {
    const doc = await getDocument(db, id);
    if (!doc) throw new NotFoundError("Document");
    if (doc.status !== "draft") throw new TransitionError("Only drafts can be deleted");
    if (doc.linked && doc.kind === "quotation") throw new TransitionError("This quotation has an invoice");
    await db.run("DELETE FROM documents WHERE account_id = $1 AND id = $2", db.accountId, id);
    if (doc.kind === "invoice" && doc.sourceDocumentId) {
      // Deleting the draft invoice re-opens the quotation it came from.
      await db.run(
        "UPDATE documents SET status = 'accepted', updated_at = $3 WHERE account_id = $1 AND id = $2 AND status = 'converted'",
        db.accountId,
        doc.sourceDocumentId,
        nowIso(),
      );
    }
    await logActivity(db, { type: `${doc.kind}.deleted`, message: `${label(doc.kind)} draft ${doc.number} deleted`, customerId: doc.customerId });
  });
}
