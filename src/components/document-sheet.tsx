import { taxBreakdown } from "@/lib/calc";
import type { Formatter } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { Customer } from "@/lib/services/customers";
import type { DocumentDetail } from "@/lib/services/documents";
import type { Settings } from "@/lib/validation";
import { StatusBadge } from "./ui";

/**
 * The printable quotation / invoice template. Used both on the detail page and
 * on the print route, so what users see is exactly what they print or save as PDF.
 */
export function DocumentSheet({
  doc,
  customer,
  settings,
  t,
  fmt,
}: {
  doc: DocumentDetail;
  customer: Customer;
  settings: Settings;
  t: Dictionary;
  fmt: Formatter;
}) {
  const isInvoice = doc.kind === "invoice";
  const b = settings.business;
  const taxes = taxBreakdown(doc.items);
  const money = (v: number) => fmt.money(v, doc.currency);

  return (
    <article className="print-sheet mx-auto max-w-[210mm] rounded-lg border border-slate-200 bg-white p-6 text-slate-800 shadow-sm sm:p-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xl font-bold text-slate-900">{b.name}</p>
          <div className="mt-1 space-y-0.5 text-sm text-slate-600">
            {b.address && <p className="whitespace-pre-line">{b.address}</p>}
            {(b.phone || b.email) && <p>{[b.phone, b.email].filter(Boolean).join(" · ")}</p>}
            {b.website && <p>{b.website}</p>}
            {b.taxId && <p>{b.taxId}</p>}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-brand-700">{isInvoice ? t.documents.invoice : t.documents.quotation}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{doc.number}</p>
          <div className="mt-2">
            <StatusBadge status={doc.displayStatus} label={t.status[doc.displayStatus]} />
          </div>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-6 border-y border-slate-200 py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isInvoice ? t.documents.billTo : t.documents.quoteTo}</p>
          <p className="mt-1 font-semibold text-slate-900">{customer.name}</p>
          <div className="text-sm text-slate-600">
            {customer.company && <p>{customer.company}</p>}
            {customer.address && <p className="whitespace-pre-line">{customer.address}</p>}
            {(customer.city || customer.country) && <p>{[customer.city, customer.country].filter(Boolean).join(", ")}</p>}
            {customer.email && <p>{customer.email}</p>}
            {customer.phone && <p>{customer.phone}</p>}
            {customer.taxId && <p>{customer.taxId}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 self-start text-sm sm:justify-self-end">
          <dt className="text-slate-500">{t.documents.issueDate}</dt>
          <dd className="text-right font-medium">{fmt.date(doc.issueDate)}</dd>
          <dt className="text-slate-500">{isInvoice ? t.documents.dueDate : t.documents.validUntil}</dt>
          <dd className="text-right font-medium">{fmt.date(doc.dueDate)}</dd>
          <dt className="text-slate-500">{t.documents.currency}</dt>
          <dd className="text-right font-medium">{doc.currency}</dd>
        </dl>
      </section>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-800 text-left text-xs uppercase tracking-wide text-slate-600">
              <th className="py-2 pr-2 font-semibold">#</th>
              <th className="py-2 pr-4 font-semibold">{t.documents.description}</th>
              <th className="py-2 px-2 text-right font-semibold">{t.documents.quantity}</th>
              <th className="py-2 px-2 text-right font-semibold">{t.documents.unitPrice}</th>
              <th className="py-2 px-2 text-right font-semibold">{t.documents.discount}</th>
              <th className="py-2 px-2 text-right font-semibold">{t.documents.tax}</th>
              <th className="py-2 pl-2 text-right font-semibold">{t.documents.lineTotal}</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((i, n) => (
              <tr key={i.id} className="border-b border-slate-100 align-top">
                <td className="py-2.5 pr-2 text-slate-500">{fmt.number(n + 1)}</td>
                <td className="py-2.5 pr-4 whitespace-pre-line">{i.description}</td>
                <td className="tabular py-2.5 px-2 text-right">{fmt.quantity(i.quantityMilli)}</td>
                <td className="tabular py-2.5 px-2 text-right whitespace-nowrap">{money(i.unitPrice)}</td>
                <td className="tabular py-2.5 px-2 text-right whitespace-nowrap">
                  {i.discountValue === 0 ? "—" : i.discountType === "percent" ? fmt.percent(i.discountValue) : money(i.discountValue)}
                </td>
                <td className="tabular py-2.5 px-2 text-right whitespace-nowrap">{i.taxRateBps ? fmt.percent(i.taxRateBps) : "—"}</td>
                <td className="tabular py-2.5 pl-2 text-right font-medium whitespace-nowrap">{money(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6 flex flex-col-reverse gap-6 sm:flex-row sm:justify-between">
        <div className="text-sm text-slate-600 sm:max-w-[55%]">
          {taxes.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.documents.taxSummary}</p>
              <table className="mt-1 text-xs">
                <tbody>
                  {taxes.map((x) => (
                    <tr key={`${x.name}${x.rateBps}`}>
                      <td className="pr-4">{x.name}</td>
                      <td className="tabular pr-4 text-right">{money(x.taxable)}</td>
                      <td className="tabular text-right">{money(x.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <dl className="w-full space-y-1.5 text-sm sm:w-72">
          <div className="flex justify-between">
            <dt className="text-slate-500">{t.documents.subtotal}</dt>
            <dd className="tabular">{money(doc.subtotal)}</dd>
          </div>
          {doc.discountTotal > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">{t.documents.discountTotal}</dt>
              <dd className="tabular">− {money(doc.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-500">{settings.taxLabel}</dt>
            <dd className="tabular">{money(doc.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t-2 border-slate-800 pt-2 text-base font-semibold text-slate-900">
            <dt>{t.documents.total}</dt>
            <dd className="tabular">{money(doc.total)}</dd>
          </div>
          {isInvoice && doc.amountPaid > 0 && (
            <>
              <div className="flex justify-between text-emerald-700">
                <dt>{t.documents.amountPaid}</dt>
                <dd className="tabular">− {money(doc.amountPaid)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-slate-900">
                <dt>{t.documents.balance}</dt>
                <dd className="tabular">{money(doc.balance)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {(doc.notes || doc.terms) && (
        <section className="mt-8 grid grid-cols-1 gap-6 border-t border-slate-200 pt-5 text-sm sm:grid-cols-2">
          {doc.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.common.notes}</p>
              <p className="mt-1 whitespace-pre-line text-slate-700">{doc.notes}</p>
            </div>
          )}
          {doc.terms && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.documents.terms}</p>
              <p className="mt-1 whitespace-pre-line text-slate-700">{doc.terms}</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-slate-100 pt-4 text-center text-xs text-slate-500">
        {settings.documentFooter || t.documents.thankYou}
      </footer>
    </article>
  );
}
