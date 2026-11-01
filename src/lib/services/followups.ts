import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { TenantDb } from "../db";
import { idEq, nowIso } from "../db";
import { customers, documents, followUps } from "../db/schema";
import { todayIso } from "../dates";
import { TransitionError } from "../status";
import { followUpSchema } from "../validation";
import { logActivity } from "./activity";
import { getCustomer, NotFoundError } from "./customers";

export type FollowUpStatus = "pending" | "completed";
export type FollowUpDisplayStatus = FollowUpStatus | "overdue" | "due_today";

export interface FollowUp {
  id: number;
  title: string;
  note: string;
  dueDate: string;
  status: FollowUpStatus;
  displayStatus: FollowUpDisplayStatus;
  customerId: number | null;
  customerName: string | null;
  documentId: number | null;
  documentNumber: string | null;
  documentKind: "quotation" | "invoice" | null;
  completedAt: string | null;
  createdAt: string;
}

export function followUpDisplayStatus(f: { status: FollowUpStatus; dueDate: string }, today: string): FollowUpDisplayStatus {
  if (f.status === "completed") return "completed";
  if (f.dueDate < today) return "overdue";
  if (f.dueDate === today) return "due_today";
  return "pending";
}

const selectFollowUps = (db: TenantDb) =>
  db.orm
    .select({
      id: followUps.id,
      title: followUps.title,
      note: followUps.note,
      dueDate: followUps.dueDate,
      status: followUps.status,
      customerId: followUps.customerId,
      customerName: customers.name,
      documentId: followUps.documentId,
      documentNumber: documents.number,
      documentKind: documents.kind,
      completedAt: followUps.completedAt,
      createdAt: followUps.createdAt,
    })
    .from(followUps)
    .leftJoin(customers, and(eq(customers.accountId, followUps.accountId), eq(customers.id, followUps.customerId)))
    .leftJoin(documents, and(eq(documents.accountId, followUps.accountId), eq(documents.id, followUps.documentId)))
    .$dynamic();

type Row = Omit<FollowUp, "displayStatus">;

export async function listFollowUps(
  db: TenantDb,
  opts: { filter?: "all" | "pending" | "completed" | "overdue"; customerId?: number; limit?: number } = {},
  today = todayIso(),
): Promise<FollowUp[]> {
  const pending = eq(followUps.status, "pending");
  const filter =
    opts.filter === "pending"
      ? and(pending, gte(followUps.dueDate, today))
      : opts.filter === "overdue"
        ? and(pending, lt(followUps.dueDate, today))
        : opts.filter === "completed"
          ? eq(followUps.status, "completed")
          : undefined;
  let query = selectFollowUps(db)
    .where(and(db.owns(followUps), opts.customerId ? idEq(followUps.customerId, opts.customerId) : undefined, filter))
    .orderBy(
      ...(opts.filter === "completed"
        ? [sql`${followUps.completedAt} DESC NULLS LAST`]
        : [desc(followUps.status), asc(followUps.dueDate), asc(followUps.id)]),
    );
  if (opts.limit) query = query.limit(Number(opts.limit));
  return withDisplay(await query, today);
}

const withDisplay = (rows: Row[], today: string): FollowUp[] => rows.map((r) => ({ ...r, displayStatus: followUpDisplayStatus(r, today) }));

/** Pending items due within `days` days, including everything overdue. */
export async function upcomingFollowUps(db: TenantDb, days = 7, today = todayIso()): Promise<FollowUp[]> {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const rows = await selectFollowUps(db)
    .where(and(db.owns(followUps), eq(followUps.status, "pending"), lte(followUps.dueDate, until.toISOString().slice(0, 10))))
    .orderBy(asc(followUps.dueDate), asc(followUps.id));
  return withDisplay(rows, today);
}

export async function reminderCounts(db: TenantDb, today = todayIso()): Promise<{ overdue: number; dueToday: number }> {
  const [r] = await db.orm
    .select({
      overdue: sql<number>`COUNT(*) FILTER (WHERE ${followUps.dueDate} < ${today})`,
      dueToday: sql<number>`COUNT(*) FILTER (WHERE ${followUps.dueDate} = ${today})`,
    })
    .from(followUps)
    .where(and(db.owns(followUps), eq(followUps.status, "pending")));
  return { overdue: r.overdue, dueToday: r.dueToday };
}

export async function createFollowUp(db: TenantDb, raw: unknown): Promise<number> {
  const f = followUpSchema.parse(raw);
  return db.tx(async (db) => {
    let customerId = f.customerId;
    if (f.documentId) {
      const [doc] = await db.orm.select({ customerId: documents.customerId }).from(documents).where(db.byId(documents, f.documentId));
      if (!doc) throw new NotFoundError("Document");
      customerId = customerId ?? doc.customerId;
      if (customerId !== doc.customerId) throw new TransitionError("Document belongs to a different customer");
    }
    if (customerId && !(await getCustomer(db, customerId))) throw new NotFoundError("Customer");
    const [{ id }] = await db.orm
      .insert(followUps)
      .values({
        accountId: db.accountId,
        title: f.title,
        note: f.note,
        dueDate: f.dueDate,
        customerId,
        documentId: f.documentId,
        createdAt: nowIso(),
      })
      .returning({ id: followUps.id });
    await logActivity(db, { type: "followup.created", message: `Follow-up scheduled: ${f.title} (${f.dueDate})`, customerId, documentId: f.documentId });
    return id;
  });
}

export async function setFollowUpCompleted(db: TenantDb, id: number, completed: boolean): Promise<void> {
  await db.tx(async (db) => {
    const [f] = await db.orm
      .select({ title: followUps.title, customerId: followUps.customerId })
      .from(followUps)
      .where(db.byId(followUps, id));
    if (!f) throw new NotFoundError("Follow-up");
    await db.orm
      .update(followUps)
      .set({ status: completed ? "completed" : "pending", completedAt: completed ? nowIso() : null })
      .where(db.byId(followUps, id));
    if (completed) await logActivity(db, { type: "followup.completed", message: `Follow-up done: ${f.title}`, customerId: f.customerId });
  });
}

export async function deleteFollowUp(db: TenantDb, id: number): Promise<void> {
  await db.orm.delete(followUps).where(db.byId(followUps, id));
}
