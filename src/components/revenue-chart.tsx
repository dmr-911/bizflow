import type { Formatter } from "@/lib/format";
import type { MonthRow } from "@/lib/services/reports";

/** Dependency-free paired bar chart (invoiced vs received) rendered on the server. */
export function RevenueChart({ rows, fmt, labels }: { rows: MonthRow[]; fmt: Formatter; labels: { invoiced: string; received: string } }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.received]));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-300" />
          {labels.invoiced}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" />
          {labels.received}
        </span>
      </div>
      <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label={`${labels.invoiced} / ${labels.received}`}>
        {rows.map((r) => (
          <div key={r.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-0.5">
              <div
                className="w-1/2 max-w-5 rounded-t bg-slate-300"
                style={{ height: `${(r.invoiced / max) * 100}%` }}
                title={`${labels.invoiced}: ${fmt.money(r.invoiced, r.currency)}`}
              />
              <div
                className="w-1/2 max-w-5 rounded-t bg-brand-500"
                style={{ height: `${(r.received / max) * 100}%` }}
                title={`${labels.received}: ${fmt.money(r.received, r.currency)}`}
              />
            </div>
            <p className="mt-1.5 truncate text-center text-[11px] text-slate-500">{fmt.month(r.month).split(" ")[0]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
