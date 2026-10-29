import Link from "next/link";
import { Icon } from "@/components/icons";
import { RevenueChart } from "@/components/revenue-chart";
import { Card, FilterTabs, PageHeader, Table, Td, Th } from "@/components/ui";
import { addMonths, todayIso } from "@/lib/dates";
import { CURRENCIES, type Currency } from "@/lib/money";
import { mostActiveCustomers, outstandingBalances, revenueByMonth } from "@/lib/services/reports";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ currency?: string }> }) {
  const { db, t, fmt, settings } = await pageContext();
  const sp = await searchParams;
  const currency: Currency = CURRENCIES.includes(sp.currency as Currency) ? (sp.currency as Currency) : settings.defaultCurrency;
  const [months, outstanding, active] = await Promise.all([
    revenueByMonth(db, { months: 12, currency }),
    outstandingBalances(db),
    mostActiveCustomers(db, { since: addMonths(todayIso(), -12), limit: 10 }),
  ]);
  const totals = months.reduce((a, r) => ({ invoiced: a.invoiced + r.invoiced, received: a.received + r.received }), { invoiced: 0, received: 0 });
  const money = (v: number, c: Currency = currency) => (v ? fmt.money(v, c) : "—");

  const exports = [
    { kind: "customers", label: t.nav.customers },
    { kind: "invoices", label: t.nav.invoices },
    { kind: "quotations", label: t.nav.quotations },
    { kind: "payments", label: t.payments.title },
    { kind: "follow-ups", label: t.nav.followUps },
    { kind: `revenue?currency=${currency}&months=12`, label: `${t.reports.revenueByMonth} (${currency})` },
    { kind: "outstanding", label: t.reports.outstanding },
    { kind: "active-customers", label: t.reports.activeCustomers },
  ];

  return (
    <>
      <PageHeader
        title={t.reports.title}
        actions={<FilterTabs items={CURRENCIES.map((c) => ({ href: `/reports?currency=${c}`, label: c, active: c === currency }))} />}
      />
      <div className="space-y-6">
        <Card
          title={`${t.reports.revenueByMonth} (${currency})`}
          actions={
            <Link href={`/api/export/revenue?currency=${currency}&months=12`} prefetch={false} className="flex items-center gap-1 text-sm text-brand-600 hover:underline">
              <Icon name="download" className="size-4" /> CSV
            </Link>
          }
        >
          <p className="mb-4 text-xs text-slate-500">{t.reports.revenueHelp}</p>
          <RevenueChart rows={months} fmt={fmt} labels={{ invoiced: t.reports.invoiced, received: t.reports.received }} />
          <div className="-mx-4 mt-6 border-t border-slate-100">
            <Table>
              <thead>
                <tr>
                  <Th>{t.reports.month}</Th>
                  <Th className="text-right">{t.reports.invoiced}</Th>
                  <Th className="text-right">{t.reports.received}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...months].reverse().map((r) => (
                  <tr key={r.month}>
                    <Td>{fmt.month(r.month)}</Td>
                    <Td className="tabular text-right">{money(r.invoiced)}</Td>
                    <Td className="tabular text-right">{money(r.received)}</Td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <Td>{t.common.total}</Td>
                  <Td className="tabular text-right">{fmt.money(totals.invoiced, currency)}</Td>
                  <Td className="tabular text-right">{fmt.money(totals.received, currency)}</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        </Card>

        <Card
          title={t.reports.outstanding}
          padded={false}
          actions={
            <Link href="/api/export/outstanding" prefetch={false} className="flex items-center gap-1 text-sm text-brand-600 hover:underline">
              <Icon name="download" className="size-4" /> CSV
            </Link>
          }
        >
          <p className="px-4 pt-3 text-xs text-slate-500">{t.reports.outstandingHelp}</p>
          {outstanding.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">{t.reports.noData}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.customer}</Th>
                  <Th className="text-right">{t.reports.current}</Th>
                  <Th className="text-right">{t.reports.d1_30}</Th>
                  <Th className="text-right">{t.reports.d31_60}</Th>
                  <Th className="text-right">{t.reports.d61_90}</Th>
                  <Th className="text-right">{t.reports.d90}</Th>
                  <Th className="text-right">{t.common.total}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {outstanding.map((r) => (
                  <tr key={`${r.customerId}${r.currency}`}>
                    <Td>
                      <Link href={`/customers/${r.customerId}`} className="font-medium hover:text-brand-700">
                        {r.customerName}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {fmt.number(r.invoiceCount)} {t.nav.invoices.toLowerCase()} · {r.currency}
                      </span>
                    </Td>
                    <Td className="tabular text-right whitespace-nowrap">{money(r.current, r.currency)}</Td>
                    <Td className="tabular text-right whitespace-nowrap">{money(r.days1to30, r.currency)}</Td>
                    <Td className="tabular text-right whitespace-nowrap">{money(r.days31to60, r.currency)}</Td>
                    <Td className="tabular text-right whitespace-nowrap">{money(r.days61to90, r.currency)}</Td>
                    <Td className="tabular text-right whitespace-nowrap text-red-700">{money(r.days90plus, r.currency)}</Td>
                    <Td className="tabular text-right whitespace-nowrap font-semibold">{fmt.money(r.total, r.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title={t.reports.activeCustomers} padded={false} className="lg:col-span-2">
            <p className="px-4 pt-3 text-xs text-slate-500">{t.reports.activeHelp}</p>
            {active.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">{t.reports.noData}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.common.customer}</Th>
                    <Th className="text-right">{t.reports.documents}</Th>
                    <Th className="text-right">{t.reports.payments}</Th>
                    <Th className="text-right">{t.reports.received}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {active.map((r) => (
                    <tr key={r.customerId}>
                      <Td>
                        <Link href={`/customers/${r.customerId}`} className="font-medium hover:text-brand-700">
                          {r.customerName}
                        </Link>
                        {r.company && <span className="block text-xs text-slate-500">{r.company}</span>}
                      </Td>
                      <Td className="tabular text-right">{fmt.number(r.documents)}</Td>
                      <Td className="tabular text-right">{fmt.number(r.payments)}</Td>
                      <Td className="tabular text-right whitespace-nowrap">{Object.keys(r.received).length ? fmt.moneyByCurrency(r.received, currency) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={t.reports.exports}>
            <p className="mb-3 text-xs text-slate-500">{t.reports.exportsHelp}</p>
            <ul className="space-y-1">
              {exports.map((e) => (
                <li key={e.kind}>
                  <a href={`/api/export/${e.kind}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <Icon name="download" className="size-4 text-slate-400" />
                    {e.label}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
