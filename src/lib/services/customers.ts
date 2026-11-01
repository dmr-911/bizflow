import { and, asc, eq, ilike, inArray, isNotNull, isNull, or, sql, sum } from "drizzle-orm";
import type { TenantDb } from "../db";
import { idEq, nowIso } from "../db";
import { customers, documents } from "../db/schema";
import { customerSchema, type CustomerInput } from "../validation";
import { logActivity } from "./activity";

export interface Customer {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  taxId: string;
  notes: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListRow extends Customer {
  invoiceCount: number;
  quotationCount: number;
  /** Unpaid balance on issued invoices, per currency. */
  outstanding: Partial<Record<"BDT" | "USD", number>>;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

const fields = (c: CustomerInput) => ({
  name: c.name,
  company: c.company,
  email: c.email,
  phone: c.phone,
  address: c.address,
  city: c.city,
  country: c.country,
  taxId: c.taxId,
  notes: c.notes,
});

const customerColumns = {
  id: customers.id,
  name: customers.name,
  company: customers.company,
  email: customers.email,
  phone: customers.phone,
  address: customers.address,
  city: customers.city,
  country: customers.country,
  taxId: customers.taxId,
  notes: customers.notes,
  archivedAt: customers.archivedAt,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

export async function createCustomer(db: TenantDb, input: CustomerInput): Promise<Customer> {
  const c = customerSchema.parse(input);
  return db.tx(async (db) => {
    const now = nowIso();
    const [{ id }] = await db.orm
      .insert(customers)
      .values({ accountId: db.accountId, ...fields(c), createdAt: now, updatedAt: now })
      .returning({ id: customers.id });
    await logActivity(db, { type: "customer.created", message: `Customer ${c.name} added`, customerId: id });
    return (await getCustomer(db, id))!;
  });
}

export async function updateCustomer(db: TenantDb, id: number, input: CustomerInput): Promise<Customer> {
  const c = customerSchema.parse(input);
  return db.tx(async (db) => {
    const { rowCount } = await db.orm
      .update(customers)
      .set({ ...fields(c), updatedAt: nowIso() })
      .where(db.byId(customers, id));
    if (!rowCount) throw new NotFoundError("Customer");
    await logActivity(db, { type: "customer.updated", message: `Customer ${c.name} updated`, customerId: id });
    return (await getCustomer(db, id))!;
  });
}

export async function setCustomerArchived(db: TenantDb, id: number, archived: boolean): Promise<void> {
  await db.tx(async (db) => {
    const { rowCount } = await db.orm
      .update(customers)
      .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
      .where(db.byId(customers, id));
    if (!rowCount) throw new NotFoundError("Customer");
    const c = (await getCustomer(db, id))!;
    await logActivity(db, {
      type: archived ? "customer.archived" : "customer.restored",
      message: `Customer ${c.name} ${archived ? "archived" : "restored"}`,
      customerId: id,
    });
  });
}

export async function getCustomer(db: TenantDb, id: number): Promise<Customer | null> {
  const [row] = await db.orm.select(customerColumns).from(customers).where(db.byId(customers, id));
  return row ?? null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Correlated subqueries name the outer table in full: Drizzle leaves columns unqualified in a
// single-table select, and a bare "id" here would bind to the subquery's own table.
const countDocs = (kind: "invoice" | "quotation") =>
  sql<number>`(SELECT COUNT(*) FROM ${documents} d WHERE d.account_id = customers.account_id AND d.customer_id = customers.id AND d.kind = ${kind})`;

export async function listCustomers(
  db: TenantDb,
  opts: { search?: string; includeArchived?: boolean; archivedOnly?: boolean } = {},
): Promise<CustomerListRow[]> {
  const q = opts.search?.trim() ? `%${escapeLike(opts.search.trim())}%` : null;
  const [rows, balances] = await db.parallel(
    () =>
      db.orm
        .select({ ...customerColumns, invoiceCount: countDocs("invoice"), quotationCount: countDocs("quotation") })
        .from(customers)
        .where(
          and(
            db.owns(customers),
            opts.archivedOnly ? isNotNull(customers.archivedAt) : opts.includeArchived ? undefined : isNull(customers.archivedAt),
            q ? or(ilike(customers.name, q), ilike(customers.company, q), ilike(customers.email, q), ilike(customers.phone, q)) : undefined,
          ),
        )
        .orderBy(sql`lower(${customers.name})`, asc(customers.id)),
    () => customerBalances(db),
  );
  return rows.map((r) => ({ ...r, outstanding: balances.get(r.id) ?? {} }));
}

export async function customerBalances(db: TenantDb, customerId?: number): Promise<Map<number, CustomerListRow["outstanding"]>> {
  const rows = await db.orm
    .select({
      id: documents.customerId,
      currency: documents.currency,
      amount: sum(sql`${documents.total} - ${documents.amountPaid}`).mapWith(Number),
    })
    .from(documents)
    .where(
      and(
        db.owns(documents),
        eq(documents.kind, "invoice"),
        inArray(documents.status, ["sent", "partially_paid"]),
        customerId ? idEq(documents.customerId, customerId) : undefined,
      ),
    )
    .groupBy(documents.customerId, documents.currency);
  const map = new Map<number, CustomerListRow["outstanding"]>();
  for (const r of rows) map.set(r.id, { ...map.get(r.id), [r.currency]: r.amount });
  return map;
}

/** Lightweight list for pickers. */
export async function customerOptions(db: TenantDb, includeId?: number): Promise<{ id: number; name: string; company: string }[]> {
  return db.orm
    .select({ id: customers.id, name: customers.name, company: customers.company })
    .from(customers)
    .where(and(db.owns(customers), or(isNull(customers.archivedAt), idEq(customers.id, includeId))))
    .orderBy(sql`lower(${customers.name})`, asc(customers.id));
}
