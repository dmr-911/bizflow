import { and, desc, eq } from "drizzle-orm";
import type { TenantDb } from "../db";
import { idEq, nowIso } from "../db";
import { activities, customers, documents } from "../db/schema";

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
  await db.orm.insert(activities).values({
    accountId: db.accountId,
    type: a.type,
    message: a.message,
    customerId: a.customerId ?? null,
    documentId: a.documentId ?? null,
    createdAt: nowIso(),
  });
}

export async function recentActivity(db: TenantDb, opts: { limit?: number; customerId?: number } = {}): Promise<Activity[]> {
  return db.orm
    .select({
      id: activities.id,
      type: activities.type,
      message: activities.message,
      customerId: activities.customerId,
      customerName: customers.name,
      documentId: activities.documentId,
      documentKind: documents.kind,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .leftJoin(customers, and(eq(customers.accountId, activities.accountId), eq(customers.id, activities.customerId)))
    .leftJoin(documents, and(eq(documents.accountId, activities.accountId), eq(documents.id, activities.documentId)))
    .where(and(db.owns(activities), opts.customerId ? idEq(activities.customerId, opts.customerId) : undefined))
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(opts.limit ?? 10);
}
