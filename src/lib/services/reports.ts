import type { TenantDb } from "../db";
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

export async function dashboardStats(db: TenantDb, today = todayIso()): Promise<DashboardStats> {
  type Sum = { currency: Currency; amount: number };
  const [counts, paid, paidThisMonth, outstanding, overdue] = await Promise.all([
    db.get<Omit<DashboardStats, "paid" | "outstanding" | "overdue" | "paidThisMonth">>(
      `SELECT
         COUNT(*) FILTER (WHERE kind = 'invoice' AND status != 'cancelled') AS "invoiceCount",
         COUNT(*) FILTER (WHERE kind = 'quotation') AS "quotationCount",
         COUNT(*) FILTER (WHERE kind = 'quotation' AND status IN ('draft','sent','accepted')) AS "openQuotationCount",
         COUNT(*) FILTER (WHERE kind = 'invoice' AND status IN ('sent','partially_paid') AND due_date < $2) AS "overdueCount"
       FROM documents WHERE account_id = $1`,
      db.accountId,
      today,
    ),
    db.all<Sum>(
      `SELECT d.currency, SUM(p.amount) AS amount FROM payments p
       JOIN documents d ON d.account_id = p.account_id AND d.id = p.invoice_id
       WHERE p.account_id = $1 GROUP BY d.currency`,
      db.accountId,
    ),
    db.all<Sum>(
      `SELECT d.currency, SUM(p.amount) AS amount FROM payments p
       JOIN documents d ON d.account_id = p.account_id AND d.id = p.invoice_id
       WHERE p.account_id = $1 AND substr(p.paid_at, 1, 7) = $2 GROUP BY d.currency`,
      db.accountId,
      today.slice(0, 7),
    ),
    db.all<Sum>(
      `SELECT currency, SUM(total - amount_paid) AS amount FROM documents
       WHERE account_id = $1 AND kind = 'invoice' AND status IN ('sent','partially_paid') GROUP BY currency`,
      db.accountId,
    ),
    db.all<Sum>(
      `SELECT currency, SUM(total - amount_paid) AS amount FROM documents
       WHERE account_id = $1 AND kind = 'invoice' AND status IN ('sent','partially_paid') AND due_date < $2 GROUP BY currency`,
      db.accountId,
      today,
    ),
  ]);
  return {
    ...counts!,
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
export async function revenueByMonth(db: TenantDb, opts: { months?: number; currency: Currency; today?: string }): Promise<MonthRow[]> {
  const today = opts.today ?? todayIso();
  const months = lastMonths(today, opts.months ?? 12);
  const from = `${months[0]}-01`;
  const [received, invoiced] = await Promise.all([
    db.all<{ month: string; amount: number }>(
      `SELECT substr(p.paid_at, 1, 7) AS month, SUM(p.amount) AS amount
       FROM payments p JOIN documents d ON d.account_id = p.account_id AND d.id = p.invoice_id
       WHERE p.account_id = $1 AND d.currency = $2 AND p.paid_at >= $3 GROUP BY month`,
      db.accountId,
      opts.currency,
      from,
    ),
    db.all<{ month: string; amount: number }>(
      `SELECT substr(issue_date, 1, 7) AS month, SUM(total) AS amount FROM documents
       WHERE account_id = $1 AND kind = 'invoice' AND status NOT IN ('draft','cancelled') AND currency = $2 AND issue_date >= $3
       GROUP BY month`,
      db.accountId,
      opts.currency,
      from,
    ),
  ]);
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
export async function outstandingBalances(db: TenantDb, today = todayIso()): Promise<OutstandingRow[]> {
  const rows = await db.all<{ customerId: number; customerName: string; currency: Currency; dueDate: string | null; issueDate: string; balance: number }>(
    `SELECT d.customer_id AS "customerId", c.name AS "customerName", d.currency, d.due_date AS "dueDate",
            d.issue_date AS "issueDate", d.total - d.amount_paid AS balance
     FROM documents d JOIN customers c ON c.account_id = d.account_id AND c.id = d.customer_id
     WHERE d.account_id = $1 AND d.kind = 'invoice' AND d.status IN ('sent','partially_paid') AND d.total > d.amount_paid`,
    db.accountId,
  );
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
export async function mostActiveCustomers(db: TenantDb, opts: { since: string; limit?: number }): Promise<ActiveCustomerRow[]> {
  const [rows, receivedRows] = await Promise.all([
    db.all<Omit<ActiveCustomerRow, "received" | "activityCount">>(
      `SELECT c.id AS "customerId", c.name AS "customerName", c.company,
         (SELECT COUNT(*) FROM documents d WHERE d.account_id = c.account_id AND d.customer_id = c.id AND d.issue_date >= $2) AS documents,
         (SELECT COUNT(*) FROM payments p JOIN documents d ON d.account_id = p.account_id AND d.id = p.invoice_id
            WHERE p.account_id = c.account_id AND d.customer_id = c.id AND p.paid_at >= $2) AS payments,
         (SELECT MAX(created_at) FROM activities a WHERE a.account_id = c.account_id AND a.customer_id = c.id) AS "lastActivity"
       FROM customers c WHERE c.account_id = $1`,
      db.accountId,
      opts.since,
    ),
    db.all<{ customerId: number; currency: Currency; amount: number }>(
      `SELECT d.customer_id AS "customerId", d.currency, SUM(p.amount) AS amount
       FROM payments p JOIN documents d ON d.account_id = p.account_id AND d.id = p.invoice_id
       WHERE p.account_id = $1 AND p.paid_at >= $2 GROUP BY d.customer_id, d.currency`,
      db.accountId,
      opts.since,
    ),
  ]);
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
