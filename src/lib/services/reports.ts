import { and, eq, gt, gte, inArray, lt, notInArray, sql, sum } from "drizzle-orm";
import type { TenantDb } from "../db";
import { activities, customers, documents, payments } from "../db/schema";
import { daysBetween, lastMonths, todayIso } from "../dates";
import type { Currency } from "../money";

/** Amounts are always grouped by currency: BDT and USD are never added together. */
export type ByCurrency = Partial<Record<Currency, number>>;

function group(rows: { currency: Currency; amount: number }[]): ByCurrency {
  const out: ByCurrency = {};
  for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + r.amount;
  return out;
}

/** payments → the invoice they belong to, within the same business. */
const invoiceOf = and(eq(documents.accountId, payments.accountId), eq(documents.id, payments.invoiceId));

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
  const unpaid = and(db.owns(documents), eq(documents.kind, "invoice"), inArray(documents.status, ["sent", "partially_paid"]));
  const balance = sum(sql`${documents.total} - ${documents.amountPaid}`).mapWith(Number);
  const received = (where?: ReturnType<typeof and>) =>
    db.orm
      .select({ currency: documents.currency, amount: sum(payments.amount).mapWith(Number) })
      .from(payments)
      .innerJoin(documents, invoiceOf)
      .where(and(db.owns(payments), where))
      .groupBy(documents.currency);
  const [[counts], paid, paidThisMonth, outstanding, overdue] = await db.parallel(
    () =>
      db.orm
        .select({
          invoiceCount: sql<number>`COUNT(*) FILTER (WHERE ${documents.kind} = 'invoice' AND ${documents.status} != 'cancelled')`,
          quotationCount: sql<number>`COUNT(*) FILTER (WHERE ${documents.kind} = 'quotation')`,
          openQuotationCount: sql<number>`COUNT(*) FILTER (WHERE ${documents.kind} = 'quotation' AND ${documents.status} IN ('draft','sent','accepted'))`,
          overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${documents.kind} = 'invoice' AND ${documents.status} IN ('sent','partially_paid') AND ${documents.dueDate} < ${today})`,
        })
        .from(documents)
        .where(db.owns(documents)),
    () => received(),
    () => received(eq(sql`substr(${payments.paidAt}, 1, 7)`, today.slice(0, 7))),
    () => db.orm.select({ currency: documents.currency, amount: balance }).from(documents).where(unpaid).groupBy(documents.currency),
    () =>
      db.orm
        .select({ currency: documents.currency, amount: balance })
        .from(documents)
        .where(and(unpaid, lt(documents.dueDate, today)))
        .groupBy(documents.currency),
  );
  return {
    ...counts,
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
  const paidMonth = sql<string>`substr(${payments.paidAt}, 1, 7)`;
  const issuedMonth = sql<string>`substr(${documents.issueDate}, 1, 7)`;
  const [received, invoiced] = await db.parallel(
    () =>
      db.orm
        .select({ month: paidMonth, amount: sum(payments.amount).mapWith(Number) })
        .from(payments)
        .innerJoin(documents, invoiceOf)
        .where(and(db.owns(payments), eq(documents.currency, opts.currency), gte(payments.paidAt, from)))
        .groupBy(paidMonth),
    () =>
      db.orm
        .select({ month: issuedMonth, amount: sum(documents.total).mapWith(Number) })
        .from(documents)
        .where(
          and(
            db.owns(documents),
            eq(documents.kind, "invoice"),
            notInArray(documents.status, ["draft", "cancelled"]),
            eq(documents.currency, opts.currency),
            gte(documents.issueDate, from),
          ),
        )
        .groupBy(issuedMonth),
  );
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
  const rows = await db.orm
    .select({
      customerId: documents.customerId,
      customerName: customers.name,
      currency: documents.currency,
      dueDate: documents.dueDate,
      issueDate: documents.issueDate,
      balance: sql<number>`${documents.total} - ${documents.amountPaid}`,
    })
    .from(documents)
    .innerJoin(customers, and(eq(customers.accountId, documents.accountId), eq(customers.id, documents.customerId)))
    .where(
      and(
        db.owns(documents),
        eq(documents.kind, "invoice"),
        inArray(documents.status, ["sent", "partially_paid"]),
        gt(documents.total, documents.amountPaid),
      ),
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
  // The subqueries name customers.* in full (see countDocs in customers.ts).
  const [rows, receivedRows] = await db.parallel(
    () =>
      db.orm
        .select({
          customerId: customers.id,
          customerName: customers.name,
          company: customers.company,
          documents: sql<number>`(SELECT COUNT(*) FROM ${documents} d
            WHERE d.account_id = customers.account_id AND d.customer_id = customers.id AND d.issue_date >= ${opts.since})`,
          payments: sql<number>`(SELECT COUNT(*) FROM ${payments} p JOIN ${documents} d ON d.account_id = p.account_id AND d.id = p.invoice_id
            WHERE p.account_id = customers.account_id AND d.customer_id = customers.id AND p.paid_at >= ${opts.since})`,
          lastActivity: sql<string | null>`(SELECT MAX(a.created_at) FROM ${activities} a
            WHERE a.account_id = customers.account_id AND a.customer_id = customers.id)`,
        })
        .from(customers)
        .where(db.owns(customers)),
    () =>
      db.orm
        .select({ customerId: documents.customerId, currency: documents.currency, amount: sum(payments.amount).mapWith(Number) })
        .from(payments)
        .innerJoin(documents, invoiceOf)
        .where(and(db.owns(payments), gte(payments.paidAt, opts.since)))
        .groupBy(documents.customerId, documents.currency),
  );
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
