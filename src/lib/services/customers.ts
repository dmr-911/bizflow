import type { DB } from "../db";
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
  `${t}id, ${t}name, ${t}company, ${t}email, ${t}phone, ${t}address, ${t}city, ${t}country, ${t}tax_id AS taxId,
   ${t}notes, ${t}archived_at AS archivedAt, ${t}created_at AS createdAt, ${t}updated_at AS updatedAt`;

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export function createCustomer(db: DB, input: CustomerInput): Customer {
  const c = customerSchema.parse(input);
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO customers (name, company, email, phone, address, city, country, tax_id, notes, created_at, updated_at)
       VALUES (@name, @company, @email, @phone, @address, @city, @country, @taxId, @notes, @now, @now)`,
    )
    .run({ ...c, now });
  const id = Number(res.lastInsertRowid);
  logActivity(db, { type: "customer.created", message: `Customer ${c.name} added`, customerId: id });
  return getCustomer(db, id)!;
}

export function updateCustomer(db: DB, id: number, input: CustomerInput): Customer {
  const c = customerSchema.parse(input);
  const res = db
    .prepare(
      `UPDATE customers SET name=@name, company=@company, email=@email, phone=@phone, address=@address,
        city=@city, country=@country, tax_id=@taxId, notes=@notes, updated_at=@now WHERE id=@id`,
    )
    .run({ ...c, id, now: nowIso() });
  if (res.changes === 0) throw new NotFoundError("Customer");
  logActivity(db, { type: "customer.updated", message: `Customer ${c.name} updated`, customerId: id });
  return getCustomer(db, id)!;
}

export function setCustomerArchived(db: DB, id: number, archived: boolean): void {
  const res = db
    .prepare("UPDATE customers SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(archived ? nowIso() : null, nowIso(), id);
  if (res.changes === 0) throw new NotFoundError("Customer");
  const c = getCustomer(db, id)!;
  logActivity(db, {
    type: archived ? "customer.archived" : "customer.restored",
    message: `Customer ${c.name} ${archived ? "archived" : "restored"}`,
    customerId: id,
  });
}

export function getCustomer(db: DB, id: number): Customer | null {
  return (db.prepare(`SELECT ${columns()} FROM customers WHERE id = ?`).get(id) as Customer | undefined) ?? null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function listCustomers(
  db: DB,
  opts: { search?: string; includeArchived?: boolean; archivedOnly?: boolean } = {},
): CustomerListRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.archivedOnly) where.push("c.archived_at IS NOT NULL");
  else if (!opts.includeArchived) where.push("c.archived_at IS NULL");
  if (opts.search?.trim()) {
    params.q = `%${escapeLike(opts.search.trim())}%`;
    where.push(
      "(c.name LIKE @q ESCAPE '\\' OR c.company LIKE @q ESCAPE '\\' OR c.email LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\')",
    );
  }
  const rows = db
    .prepare(
      `SELECT ${columns("c.")},
        (SELECT COUNT(*) FROM documents d WHERE d.customer_id = c.id AND d.kind = 'invoice') AS invoiceCount,
        (SELECT COUNT(*) FROM documents d WHERE d.customer_id = c.id AND d.kind = 'quotation') AS quotationCount
       FROM customers c
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all(params) as Omit<CustomerListRow, "outstanding">[];
  const balances = customerBalances(db);
  return rows.map((r) => ({ ...r, outstanding: balances.get(r.id) ?? {} }));
}

export function customerBalances(db: DB, customerId?: number): Map<number, CustomerListRow["outstanding"]> {
  const rows = db
    .prepare(
      `SELECT customer_id AS id, currency, SUM(total - amount_paid) AS amount FROM documents
       WHERE kind = 'invoice' AND status IN ('sent','partially_paid') ${customerId ? "AND customer_id = ?" : ""}
       GROUP BY customer_id, currency`,
    )
    .all(...(customerId ? [customerId] : [])) as { id: number; currency: "BDT" | "USD"; amount: number }[];
  const map = new Map<number, CustomerListRow["outstanding"]>();
  for (const r of rows) map.set(r.id, { ...map.get(r.id), [r.currency]: r.amount });
  return map;
}

/** Lightweight list for pickers. */
export function customerOptions(db: DB, includeId?: number): { id: number; name: string; company: string }[] {
  return db
    .prepare(
      `SELECT id, name, company FROM customers WHERE archived_at IS NULL OR id = ? ORDER BY name COLLATE NOCASE`,
    )
    .all(includeId ?? -1) as { id: number; name: string; company: string }[];
}
