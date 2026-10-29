import type { TenantDb } from "../db";
import { nowIso } from "../db";
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

const SELECT = `
  SELECT f.id, f.title, f.note, f.due_date AS "dueDate", f.status, f.customer_id AS "customerId", c.name AS "customerName",
         f.document_id AS "documentId", d.number AS "documentNumber", d.kind AS "documentKind",
         f.completed_at AS "completedAt", f.created_at AS "createdAt"
  FROM follow_ups f
  LEFT JOIN customers c ON c.account_id = f.account_id AND c.id = f.customer_id
  LEFT JOIN documents d ON d.account_id = f.account_id AND d.id = f.document_id`;

type Row = Omit<FollowUp, "displayStatus">;

export async function listFollowUps(
  db: TenantDb,
  opts: { filter?: "all" | "pending" | "completed" | "overdue"; customerId?: number; limit?: number } = {},
  today = todayIso(),
): Promise<FollowUp[]> {
  const where = ["f.account_id = $1"];
  const params: unknown[] = [db.accountId];
  const param = (v: unknown) => `$${params.push(v)}`;
  if (opts.customerId) where.push(`f.customer_id = ${param(opts.customerId)}`);
  switch (opts.filter) {
    case "pending":
      where.push(`f.status = 'pending' AND f.due_date >= ${param(today)}`);
      break;
    case "overdue":
      where.push(`f.status = 'pending' AND f.due_date < ${param(today)}`);
      break;
    case "completed":
      where.push("f.status = 'completed'");
      break;
  }
  const order = opts.filter === "completed" ? "f.completed_at DESC NULLS LAST" : "f.status DESC, f.due_date ASC, f.id ASC";
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`;
  return (await db.all<Row>(sql, ...params)).map((r) => ({ ...r, displayStatus: followUpDisplayStatus(r, today) }));
}

/** Pending items due within `days` days, including everything overdue. */
export async function upcomingFollowUps(db: TenantDb, days = 7, today = todayIso()): Promise<FollowUp[]> {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const rows = await db.all<Row>(
    `${SELECT} WHERE f.account_id = $1 AND f.status = 'pending' AND f.due_date <= $2 ORDER BY f.due_date ASC, f.id ASC`,
    db.accountId,
    until.toISOString().slice(0, 10),
  );
  return rows.map((r) => ({ ...r, displayStatus: followUpDisplayStatus(r, today) }));
}

export async function reminderCounts(db: TenantDb, today = todayIso()): Promise<{ overdue: number; dueToday: number }> {
  const r = (await db.get<{ overdue: number; dueToday: number }>(
    `SELECT COUNT(*) FILTER (WHERE due_date < $2) AS overdue, COUNT(*) FILTER (WHERE due_date = $2) AS "dueToday"
     FROM follow_ups WHERE account_id = $1 AND status = 'pending'`,
    db.accountId,
    today,
  ))!;
  return { overdue: r.overdue, dueToday: r.dueToday };
}

export async function createFollowUp(db: TenantDb, raw: unknown): Promise<number> {
  const f = followUpSchema.parse(raw);
  return db.tx(async (db) => {
    let customerId = f.customerId;
    if (f.documentId) {
      const doc = await db.get<{ customerId: number }>(
        `SELECT customer_id AS "customerId" FROM documents WHERE account_id = $1 AND id = $2`,
        db.accountId,
        f.documentId,
      );
      if (!doc) throw new NotFoundError("Document");
      customerId = customerId ?? doc.customerId;
      if (customerId !== doc.customerId) throw new TransitionError("Document belongs to a different customer");
    }
    if (customerId && !(await getCustomer(db, customerId))) throw new NotFoundError("Customer");
    const { id } = (await db.get<{ id: number }>(
      `INSERT INTO follow_ups (account_id, title, note, due_date, customer_id, document_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      db.accountId,
      f.title,
      f.note,
      f.dueDate,
      customerId,
      f.documentId,
      nowIso(),
    ))!;
    await logActivity(db, { type: "followup.created", message: `Follow-up scheduled: ${f.title} (${f.dueDate})`, customerId, documentId: f.documentId });
    return id;
  });
}

export async function setFollowUpCompleted(db: TenantDb, id: number, completed: boolean): Promise<void> {
  await db.tx(async (db) => {
    const f = await db.get<{ title: string; customerId: number | null }>(
      `SELECT title, customer_id AS "customerId" FROM follow_ups WHERE account_id = $1 AND id = $2`,
      db.accountId,
      id,
    );
    if (!f) throw new NotFoundError("Follow-up");
    await db.run(
      "UPDATE follow_ups SET status = $3, completed_at = $4 WHERE account_id = $1 AND id = $2",
      db.accountId,
      id,
      completed ? "completed" : "pending",
      completed ? nowIso() : null,
    );
    if (completed) await logActivity(db, { type: "followup.completed", message: `Follow-up done: ${f.title}`, customerId: f.customerId });
  });
}

export async function deleteFollowUp(db: TenantDb, id: number): Promise<void> {
  await db.run("DELETE FROM follow_ups WHERE account_id = $1 AND id = $2", db.accountId, id);
}
