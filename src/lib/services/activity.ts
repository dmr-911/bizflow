import type { TenantDb } from "../db";
import { nowIso } from "../db";

export interface Activity {
  id: number;
  type: string;
  message: string;
  customerId: number | null;
  customerName: string | null;
  documentId: number | null;
  documentKind: "quotation" | "invoice" | null;
  createdAt: string;
}

export async function logActivity(
  db: TenantDb,
  a: { type: string; message: string; customerId?: number | null; documentId?: number | null },
): Promise<void> {
  await db.run(
    "INSERT INTO activities (account_id, type, message, customer_id, document_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    db.accountId,
    a.type,
    a.message,
    a.customerId ?? null,
    a.documentId ?? null,
    nowIso(),
  );
}

export async function recentActivity(db: TenantDb, opts: { limit?: number; customerId?: number } = {}): Promise<Activity[]> {
  const params: unknown[] = [db.accountId, opts.limit ?? 10];
  if (opts.customerId) params.push(opts.customerId);
  return db.all<Activity>(
    `SELECT a.id, a.type, a.message, a.customer_id AS "customerId", c.name AS "customerName",
            a.document_id AS "documentId", d.kind AS "documentKind", a.created_at AS "createdAt"
     FROM activities a
     LEFT JOIN customers c ON c.account_id = a.account_id AND c.id = a.customer_id
     LEFT JOIN documents d ON d.account_id = a.account_id AND d.id = a.document_id
     WHERE a.account_id = $1 ${opts.customerId ? "AND a.customer_id = $3" : ""}
     ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
    ...params,
  );
}
