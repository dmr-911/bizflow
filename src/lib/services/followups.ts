import type { DB } from "../db";
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
  SELECT f.id, f.title, f.note, f.due_date AS dueDate, f.status, f.customer_id AS customerId, c.name AS customerName,
         f.document_id AS documentId, d.number AS documentNumber, d.kind AS documentKind,
         f.completed_at AS completedAt, f.created_at AS createdAt
  FROM follow_ups f
  LEFT JOIN customers c ON c.id = f.customer_id
  LEFT JOIN documents d ON d.id = f.document_id`;

type Row = Omit<FollowUp, "displayStatus">;

export function listFollowUps(
  db: DB,
  opts: { filter?: "all" | "pending" | "completed" | "overdue"; customerId?: number; limit?: number } = {},
  today = todayIso(),
): FollowUp[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { today };
  if (opts.customerId) {
    where.push("f.customer_id = @customerId");
    params.customerId = opts.customerId;
  }
  switch (opts.filter) {
    case "pending":
      where.push("f.status = 'pending' AND f.due_date >= @today");
      break;
    case "overdue":
      where.push("f.status = 'pending' AND f.due_date < @today");
      break;
    case "completed":
      where.push("f.status = 'completed'");
      break;
  }
  const order = opts.filter === "completed" ? "f.completed_at DESC" : "f.status DESC, f.due_date ASC, f.id ASC";
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`;
  return (db.prepare(sql).all(params) as Row[]).map((r) => ({ ...r, displayStatus: followUpDisplayStatus(r, today) }));
}

/** Pending items due within `days` days, including everything overdue. */
export function upcomingFollowUps(db: DB, days = 7, today = todayIso()): FollowUp[] {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  return (
    db
      .prepare(`${SELECT} WHERE f.status = 'pending' AND f.due_date <= ? ORDER BY f.due_date ASC, f.id ASC`)
      .all(until.toISOString().slice(0, 10)) as Row[]
  ).map((r) => ({ ...r, displayStatus: followUpDisplayStatus(r, today) }));
}

export function reminderCounts(db: DB, today = todayIso()): { overdue: number; dueToday: number } {
  const r = db
    .prepare(
      `SELECT SUM(CASE WHEN due_date < @today THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN due_date = @today THEN 1 ELSE 0 END) AS dueToday
       FROM follow_ups WHERE status = 'pending'`,
    )
    .get({ today }) as { overdue: number | null; dueToday: number | null };
  return { overdue: r.overdue ?? 0, dueToday: r.dueToday ?? 0 };
}

export function createFollowUp(db: DB, raw: unknown): number {
  const f = followUpSchema.parse(raw);
  return db.transaction(() => {
    let customerId = f.customerId;
    if (f.documentId) {
      const doc = db.prepare("SELECT customer_id AS customerId FROM documents WHERE id = ?").get(f.documentId) as
        | { customerId: number }
        | undefined;
      if (!doc) throw new NotFoundError("Document");
      customerId = customerId ?? doc.customerId;
      if (customerId !== doc.customerId) throw new TransitionError("Document belongs to a different customer");
    }
    if (customerId && !getCustomer(db, customerId)) throw new NotFoundError("Customer");
    const res = db
      .prepare(
        `INSERT INTO follow_ups (title, note, due_date, customer_id, document_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(f.title, f.note, f.dueDate, customerId, f.documentId, nowIso());
    logActivity(db, { type: "followup.created", message: `Follow-up scheduled: ${f.title} (${f.dueDate})`, customerId, documentId: f.documentId });
    return Number(res.lastInsertRowid);
  })();
}

export function setFollowUpCompleted(db: DB, id: number, completed: boolean): void {
  const f = db.prepare("SELECT title, customer_id AS customerId FROM follow_ups WHERE id = ?").get(id) as
    | { title: string; customerId: number | null }
    | undefined;
  if (!f) throw new NotFoundError("Follow-up");
  db.prepare("UPDATE follow_ups SET status = ?, completed_at = ? WHERE id = ?").run(
    completed ? "completed" : "pending",
    completed ? nowIso() : null,
    id,
  );
  if (completed) logActivity(db, { type: "followup.completed", message: `Follow-up done: ${f.title}`, customerId: f.customerId });
}

export function deleteFollowUp(db: DB, id: number): void {
  db.prepare("DELETE FROM follow_ups WHERE id = ?").run(id);
}
