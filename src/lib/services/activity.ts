import type { DB } from "../db";
import { nowIso } from "../db";

export interface Activity {
  id: number;
  type: string;
  message: string;
  customerId: number | null;
  customerName: string | null;
  documentId: number | null;
  createdAt: string;
}

export function logActivity(
  db: DB,
  a: { type: string; message: string; customerId?: number | null; documentId?: number | null },
): void {
  db.prepare(
    "INSERT INTO activities (type, message, customer_id, document_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(a.type, a.message, a.customerId ?? null, a.documentId ?? null, nowIso());
}

export function recentActivity(db: DB, opts: { limit?: number; customerId?: number } = {}): Activity[] {
  const where = opts.customerId ? "WHERE a.customer_id = ?" : "";
  const params: unknown[] = opts.customerId ? [opts.customerId] : [];
  return db
    .prepare(
      `SELECT a.id, a.type, a.message, a.customer_id AS customerId, c.name AS customerName,
              a.document_id AS documentId, a.created_at AS createdAt
       FROM activities a LEFT JOIN customers c ON c.id = a.customer_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...params, opts.limit ?? 10) as Activity[];
}
