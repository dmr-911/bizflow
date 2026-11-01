import type { TenantDb } from "../db";
import { nowIso } from "../db";
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

const columns = (t = "") =>
  `${t}id, ${t}name, ${t}company, ${t}email, ${t}phone, ${t}address, ${t}city, ${t}country, ${t}tax_id AS "taxId",
   ${t}notes, ${t}archived_at AS "archivedAt", ${t}created_at AS "createdAt", ${t}updated_at AS "updatedAt"`;

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export async function createCustomer(db: TenantDb, input: CustomerInput): Promise<Customer> {
  const c = customerSchema.parse(input);
  return db.tx(async (db) => {
    const now = nowIso();
    const { id } = (await db.get<{ id: number }>(
      `INSERT INTO customers (account_id, name, company, email, phone, address, city, country, tax_id, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
      db.accountId,
      c.name,
      c.company,
      c.email,
      c.phone,
      c.address,
      c.city,
      c.country,
      c.taxId,
      c.notes,
      now,
    ))!;
    await logActivity(db, { type: "customer.created", message: `Customer ${c.name} added`, customerId: id });
    return (await getCustomer(db, id))!;
  });
}

export async function updateCustomer(db: TenantDb, id: number, input: CustomerInput): Promise<Customer> {
  const c = customerSchema.parse(input);
  return db.tx(async (db) => {
    const changed = await db.run(
      `UPDATE customers SET name = $3, company = $4, email = $5, phone = $6, address = $7,
         city = $8, country = $9, tax_id = $10, notes = $11, updated_at = $12 WHERE account_id = $1 AND id = $2`,
      db.accountId,
      id,
      c.name,
      c.company,
      c.email,
      c.phone,
      c.address,
      c.city,
      c.country,
      c.taxId,
      c.notes,
      nowIso(),
    );
    if (changed === 0) throw new NotFoundError("Customer");
    await logActivity(db, { type: "customer.updated", message: `Customer ${c.name} updated`, customerId: id });
    return (await getCustomer(db, id))!;
  });
}

export async function setCustomerArchived(db: TenantDb, id: number, archived: boolean): Promise<void> {
  await db.tx(async (db) => {
    const changed = await db.run(
      "UPDATE customers SET archived_at = $3, updated_at = $4 WHERE account_id = $1 AND id = $2",
      db.accountId,
      id,
      archived ? nowIso() : null,
      nowIso(),
    );
    if (changed === 0) throw new NotFoundError("Customer");
    const c = (await getCustomer(db, id))!;
    await logActivity(db, {
      type: archived ? "customer.archived" : "customer.restored",
      message: `Customer ${c.name} ${archived ? "archived" : "restored"}`,
      customerId: id,
    });
  });
}

export async function getCustomer(db: TenantDb, id: number): Promise<Customer | null> {
  return (await db.get<Customer>(`SELECT ${columns()} FROM customers WHERE account_id = $1 AND id = $2`, db.accountId, id)) ?? null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listCustomers(
  db: TenantDb,
  opts: { search?: string; includeArchived?: boolean; archivedOnly?: boolean } = {},
): Promise<CustomerListRow[]> {
  const where = ["c.account_id = $1"];
  const params: unknown[] = [db.accountId];
  if (opts.archivedOnly) where.push("c.archived_at IS NOT NULL");
  else if (!opts.includeArchived) where.push("c.archived_at IS NULL");
  if (opts.search?.trim()) {
    params.push(`%${escapeLike(opts.search.trim())}%`);
    where.push("(c.name ILIKE $2 OR c.company ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2)");
  }
  const [rows, balances] = await Promise.all([
    db.all<Omit<CustomerListRow, "outstanding">>(
      `SELECT ${columns("c.")},
         (SELECT COUNT(*) FROM documents d WHERE d.account_id = c.account_id AND d.customer_id = c.id AND d.kind = 'invoice') AS "invoiceCount",
         (SELECT COUNT(*) FROM documents d WHERE d.account_id = c.account_id AND d.customer_id = c.id AND d.kind = 'quotation') AS "quotationCount"
       FROM customers c
       WHERE ${where.join(" AND ")}
       ORDER BY lower(c.name), c.id`,
      ...params,
    ),
    customerBalances(db),
  ]);
  return rows.map((r) => ({ ...r, outstanding: balances.get(r.id) ?? {} }));
}

export async function customerBalances(db: TenantDb, customerId?: number): Promise<Map<number, CustomerListRow["outstanding"]>> {
  const rows = await db.all<{ id: number; currency: "BDT" | "USD"; amount: number }>(
    `SELECT customer_id AS id, currency, SUM(total - amount_paid) AS amount FROM documents
     WHERE account_id = $1 AND kind = 'invoice' AND status IN ('sent','partially_paid') ${customerId ? "AND customer_id = $2" : ""}
     GROUP BY customer_id, currency`,
    ...(customerId ? [db.accountId, customerId] : [db.accountId]),
  );
  const map = new Map<number, CustomerListRow["outstanding"]>();
  for (const r of rows) map.set(r.id, { ...map.get(r.id), [r.currency]: r.amount });
  return map;
}

/** Lightweight list for pickers. */
export async function customerOptions(db: TenantDb, includeId?: number): Promise<{ id: number; name: string; company: string }[]> {
  return db.all<{ id: number; name: string; company: string }>(
    `SELECT id, name, company FROM customers WHERE account_id = $1 AND (archived_at IS NULL OR id = $2) ORDER BY lower(name), id`,
    db.accountId,
    includeId ?? -1,
  );
}
