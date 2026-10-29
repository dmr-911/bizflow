import type { DB } from "@/lib/db";
import { minorToDecimalString } from "@/lib/money";
import { todayIso } from "@/lib/dates";
import { toCsv } from "@/lib/csv";
import { listCustomers } from "@/lib/services/customers";
import { listDocuments } from "@/lib/services/documents";
import { listFollowUps } from "@/lib/services/followups";
import { mostActiveCustomers, outstandingBalances, revenueByMonth } from "@/lib/services/reports";
import { getSettings } from "@/lib/services/settings";
import { routeTenant } from "@/lib/server/route-auth";
import { addMonths } from "@/lib/dates";
import type { Currency } from "@/lib/money";

type Cell = string | number | null;
const m = (v: number, c: Currency = "BDT") => minorToDecimalString(v, c);

function build(db: DB, kind: string, url: URL): { header: string[]; rows: Cell[][] } | null {
  const settings = getSettings(db);
  switch (kind) {
    case "customers":
      return {
        header: ["id", "name", "company", "email", "phone", "address", "city", "country", "tax_id", "notes", "archived", "invoices", "quotations", "outstanding_bdt", "outstanding_usd", "created_at"],
        rows: listCustomers(db, { includeArchived: true }).map((c) => [
          c.id, c.name, c.company, c.email, c.phone, c.address, c.city, c.country, c.taxId, c.notes, c.archivedAt ? "yes" : "no",
          c.invoiceCount, c.quotationCount, m(c.outstanding.BDT ?? 0), m(c.outstanding.USD ?? 0, "USD"), c.createdAt,
        ]),
      };
    case "invoices":
    case "quotations": {
      const docs = listDocuments(db, kind === "invoices" ? "invoice" : "quotation");
      return {
        header: ["number", "status", "customer", "company", "issue_date", kind === "invoices" ? "due_date" : "valid_until", "currency", "subtotal", "discount", "tax", "total", "paid", "balance"],
        rows: docs.map((d) => [
          d.number, d.displayStatus, d.customerName, d.customerCompany, d.issueDate, d.dueDate, d.currency,
          m(d.subtotal, d.currency), m(d.discountTotal, d.currency), m(d.taxTotal, d.currency), m(d.total, d.currency),
          m(d.amountPaid, d.currency), m(d.status === "cancelled" ? 0 : d.balance, d.currency),
        ]),
      };
    }
    case "payments": {
      const rows = db
        .prepare(
          `SELECT p.paid_at, d.number, c.name, d.currency, p.amount, p.method, p.reference, p.note
           FROM payments p JOIN documents d ON d.id = p.invoice_id JOIN customers c ON c.id = d.customer_id
           ORDER BY p.paid_at, p.id`,
        )
        .all() as { paid_at: string; number: string; name: string; currency: Currency; amount: number; method: string; reference: string; note: string }[];
      return {
        header: ["paid_at", "invoice", "customer", "currency", "amount", "method", "reference", "note"],
        rows: rows.map((r) => [r.paid_at, r.number, r.name, r.currency, m(r.amount, r.currency), r.method, r.reference, r.note]),
      };
    }
    case "follow-ups":
      return {
        header: ["due_date", "status", "title", "customer", "document", "note", "completed_at"],
        rows: listFollowUps(db).map((f) => [f.dueDate, f.displayStatus, f.title, f.customerName, f.documentNumber, f.note, f.completedAt]),
      };
    case "revenue": {
      const currency = (url.searchParams.get("currency") === "USD" ? "USD" : url.searchParams.get("currency") === "BDT" ? "BDT" : settings.defaultCurrency) as Currency;
      const months = Math.min(60, Math.max(1, Number(url.searchParams.get("months")) || 12));
      return {
        header: ["month", "currency", "invoiced", "received"],
        rows: revenueByMonth(db, { months, currency }).map((r) => [r.month, r.currency, m(r.invoiced, currency), m(r.received, currency)]),
      };
    }
    case "outstanding":
      return {
        header: ["customer", "currency", "invoices", "not_yet_due", "1_30_days", "31_60_days", "61_90_days", "90_plus_days", "total"],
        rows: outstandingBalances(db).map((r) => [
          r.customerName, r.currency, r.invoiceCount, m(r.current, r.currency), m(r.days1to30, r.currency), m(r.days31to60, r.currency),
          m(r.days61to90, r.currency), m(r.days90plus, r.currency), m(r.total, r.currency),
        ]),
      };
    case "active-customers":
      return {
        header: ["customer", "company", "documents", "payments", "received_bdt", "received_usd", "last_activity"],
        rows: mostActiveCustomers(db, { since: addMonths(todayIso(), -12), limit: 100 }).map((r) => [
          r.customerName, r.company, r.documents, r.payments, m(r.received.BDT ?? 0), m(r.received.USD ?? 0, "USD"), r.lastActivity,
        ]),
      };
    default:
      return null;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await routeTenant({ allowLapsed: true });
  if ("error" in auth) return auth.error;
  const { kind } = await params;
  const data = build(auth.db, kind, new URL(req.url));
  if (!data) return new Response("Not found", { status: 404 });
  // UTF-8 BOM so Excel shows Bangla text correctly.
  const body = "﻿" + toCsv(data.header, data.rows);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bizflow-${kind}-${todayIso()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
