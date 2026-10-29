import type { DB } from "../db";
import { daysBetween, lastMonths, todayIso } from "../dates";
import type { Currency } from "../money";

/** Amounts are always grouped by currency: BDT and USD are never added together. */
export type ByCurrency = Partial<Record<Currency, number>>;

function group(rows: { currency: Currency; amount: number }[]): ByCurrency {
  const out: ByCurrency = {};
  for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + r.amount;
  return out;
}

export interface DashboardStats {
  invoiceCount: number;
  quotationCount: number;
  openQuotationCount: number;
  overdueCount: number;
  paid: ByCurrency;
  outstanding: ByCurrency;
  overdue: ByCurrency;
  paidThisMonth: ByCurrency;
}

export function dashboardStats(db: DB, today = todayIso()): DashboardStats {
  const counts = db
    .prepare(
      `SELECT
         SUM(kind = 'invoice' AND status != 'cancelled') AS invoiceCount,
         SUM(kind = 'quotation') AS quotationCount,
         SUM(kind = 'quotation' AND status IN ('draft','sent','accepted')) AS openQuotationCount,
         SUM(kind = 'invoice' AND status IN ('sent','partially_paid') AND due_date < @today) AS overdueCount
       FROM documents`,
    )
    .get({ today }) as Record<string, number | null>;
  const paid = db
    .prepare(`SELECT d.currency, SUM(p.amount) AS amount FROM payments p JOIN documents d ON d.id = p.invoice_id GROUP BY d.currency`)
    .all() as { currency: Currency; amount: number }[];
  const paidThisMonth = db
    .prepare(
      `SELECT d.currency, SUM(p.amount) AS amount FROM payments p JOIN documents d ON d.id = p.invoice_id
       WHERE substr(p.paid_at, 1, 7) = ? GROUP BY d.currency`,
    )
    .all(today.slice(0, 7)) as { currency: Currency; amount: number }[];
  const outstanding = db
    .prepare(
      `SELECT currency, SUM(total - amount_paid) AS amount FROM documents
       WHERE kind = 'invoice' AND status IN ('sent','partially_paid') GROUP BY currency`,
    )
    .all() as { currency: Currency; amount: number }[];
  const overdue = db
    .prepare(
      `SELECT currency, SUM(total - amount_paid) AS amount FROM documents
       WHERE kind = 'invoice' AND status IN ('sent','partially_paid') AND due_date < ? GROUP BY currency`,
    )
    .all(today) as { currency: Currency; amount: number }[];
  return {
    invoiceCount: counts.invoiceCount ?? 0,
    quotationCount: counts.quotationCount ?? 0,
    openQuotationCount: counts.openQuotationCount ?? 0,
    overdueCount: counts.overdueCount ?? 0,
    paid: group(paid),
    outstanding: group(outstanding),
    overdue: group(overdue),
    paidThisMonth: group(paidThisMonth),
  };
}

export interface MonthRow {
  month: string; // YYYY-MM
  currency: Currency;
  invoiced: number;
  received: number;
}

/**
 * Revenue by month. "received" is cash basis (payments by payment date),
 * "invoiced" is accrual basis (issued, non-cancelled invoices by issue date).
 * Months with no activity are included as zero so charts have no gaps.
 */
export function revenueByMonth(db: DB, opts: { months?: number; currency: Currency; today?: string }): MonthRow[] {
  const today = opts.today ?? todayIso();
  const months = lastMonths(today, opts.months ?? 12);
  const from = `${months[0]}-01`;
  const received = db
    .prepare(
      `SELECT substr(p.paid_at, 1, 7) AS month, SUM(p.amount) AS amount
       FROM payments p JOIN documents d ON d.id = p.invoice_id
       WHERE d.currency = ? AND p.paid_at >= ? GROUP BY month`,
    )
    .all(opts.currency, from) as { month: string; amount: number }[];
  const invoiced = db
    .prepare(
      `SELECT substr(issue_date, 1, 7) AS month, SUM(total) AS amount FROM documents
       WHERE kind = 'invoice' AND status NOT IN ('draft','cancelled') AND currency = ? AND issue_date >= ?
       GROUP BY month`,
    )
    .all(opts.currency, from) as { month: string; amount: number }[];
  const r = new Map(received.map((x) => [x.month, x.amount]));
  const i = new Map(invoiced.map((x) => [x.month, x.amount]));
  return months.map((month) => ({ month, currency: opts.currency, invoiced: i.get(month) ?? 0, received: r.get(month) ?? 0 }));
}

export interface OutstandingRow {
  customerId: number;
  customerName: string;
  currency: Currency;
  invoiceCount: number;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
}

/** Outstanding balances per customer with simple aging buckets by days past due. */
export function outstandingBalances(db: DB, today = todayIso()): OutstandingRow[] {
  const rows = db
    .prepare(
      `SELECT d.customer_id AS customerId, c.name AS customerName, d.currency, d.due_date AS dueDate,
              d.issue_date AS issueDate, d.total - d.amount_paid AS balance
       FROM documents d JOIN customers c ON c.id = d.customer_id
       WHERE d.kind = 'invoice' AND d.status IN ('sent','partially_paid') AND d.total > d.amount_paid`,
    )
    .all() as { customerId: number; customerName: string; currency: Currency; dueDate: string | null; issueDate: string; balance: number }[];
  const map = new Map<string, OutstandingRow>();
  for (const r of rows) {
    const key = `${r.customerId}|${r.currency}`;
    const row =
      map.get(key) ??
      ({ customerId: r.customerId, customerName: r.customerName, currency: r.currency, invoiceCount: 0, current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, total: 0 } as OutstandingRow);
    const late = daysBetween(r.dueDate ?? r.issueDate, today);
    if (late <= 0) row.current += r.balance;
    else if (late <= 30) row.days1to30 += r.balance;
    else if (late <= 60) row.days31to60 += r.balance;
    else if (late <= 90) row.days61to90 += r.balance;
    else row.days90plus += r.balance;
    row.total += r.balance;
    row.invoiceCount += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface ActiveCustomerRow {
  customerId: number;
  customerName: string;
  company: string;
  documents: number;
  payments: number;
  activityCount: number;
  received: ByCurrency;
  lastActivity: string | null;
}

/** Customers ranked by how much business happened with them in the period. */
export function mostActiveCustomers(db: DB, opts: { since: string; limit?: number }): ActiveCustomerRow[] {
  const rows = db
    .prepare(
      `SELECT c.id AS customerId, c.name AS customerName, c.company,
         (SELECT COUNT(*) FROM documents d WHERE d.customer_id = c.id AND d.issue_date >= @since) AS documents,
         (SELECT COUNT(*) FROM payments p JOIN documents d ON d.id = p.invoice_id
            WHERE d.customer_id = c.id AND p.paid_at >= @since) AS payments,
         (SELECT MAX(created_at) FROM activities a WHERE a.customer_id = c.id) AS lastActivity
       FROM customers c`,
    )
    .all({ since: opts.since }) as Omit<ActiveCustomerRow, "received" | "activityCount">[];
  const receivedRows = db
    .prepare(
      `SELECT d.customer_id AS customerId, d.currency, SUM(p.amount) AS amount
       FROM payments p JOIN documents d ON d.id = p.invoice_id WHERE p.paid_at >= ? GROUP BY d.customer_id, d.currency`,
    )
    .all(opts.since) as { customerId: number; currency: Currency; amount: number }[];
  return rows
    .map((r) => ({
      ...r,
      activityCount: r.documents + r.payments,
      received: group(receivedRows.filter((x) => x.customerId === r.customerId)),
    }))
    .filter((r) => r.activityCount > 0)
    .sort((a, b) => b.activityCount - a.activityCount || (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""))
    .slice(0, opts.limit ?? 10);
}
