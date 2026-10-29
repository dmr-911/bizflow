import Link from "next/link";
import { deleteFollowUpAction, toggleFollowUpAction } from "@/app/actions/followups";
import type { Formatter } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { FollowUp } from "@/lib/services/followups";
import { Icon } from "./icons";
import { cx, StatusBadge } from "./ui";

export { FollowUpForm } from "./follow-up-form";

export function FollowUpList({ items, t, fmt, showCustomer = false }: { items: FollowUp[]; t: Dictionary; fmt: Formatter; showCustomer?: boolean }) {
  if (items.length === 0) return <p className="px-4 py-6 text-sm text-slate-500">{t.followUps.empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((f) => (
        <li key={f.id} className="flex items-start gap-3 px-4 py-3">
          <form action={toggleFollowUpAction} className="pt-0.5">
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="completed" value={f.status === "completed" ? "0" : "1"} />
            <button
              type="submit"
              title={f.status === "completed" ? t.followUps.reopen : t.followUps.markDone}
              aria-label={`${f.status === "completed" ? t.followUps.reopen : t.followUps.markDone}: ${f.title}`}
              className={cx(
                "flex size-5 items-center justify-center rounded border transition",
                f.status === "completed" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white hover:border-brand-500",
              )}
            >
              {f.status === "completed" && <Icon name="check" className="size-3.5" />}
            </button>
          </form>
          <div className="min-w-0 flex-1">
            <p className={cx("text-sm font-medium", f.status === "completed" ? "text-slate-400 line-through" : "text-slate-800")}>{f.title}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
              <span>{fmt.date(f.dueDate)}</span>
              {showCustomer && f.customerName && f.customerId && (
                <Link href={`/customers/${f.customerId}`} className="hover:underline">
                  {f.customerName}
                </Link>
              )}
              {f.documentId && f.documentNumber && (
                <Link href={`/${f.documentKind === "invoice" ? "invoices" : "quotations"}/${f.documentId}`} className="hover:underline">
                  {f.documentNumber}
                </Link>
              )}
            </p>
            {f.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{f.note}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={f.displayStatus} label={t.status[f.displayStatus]} />
            <form action={deleteFollowUpAction}>
              <input type="hidden" name="id" value={f.id} />
              <button type="submit" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`${t.common.delete}: ${f.title}`} title={t.common.delete}>
                <Icon name="trash" className="size-4" />
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
