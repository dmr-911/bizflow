import { notFound } from "next/navigation";
import { archiveCustomerAction } from "@/app/actions/customers";
import { DocumentTable } from "@/components/document-table";
import { FollowUpForm, FollowUpList } from "@/components/follow-ups";
import { Alert, Button, Card, LinkButton, MoneyLines, PageHeader, StatCard } from "@/components/ui";
import { recentActivity } from "@/lib/services/activity";
import { customerBalances, customerOptions, getCustomer } from "@/lib/services/customers";
import { listDocuments } from "@/lib/services/documents";
import { listFollowUps } from "@/lib/services/followups";
import { pageContext } from "@/lib/server/context";
import { todayIso } from "@/lib/dates";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, t, fmt, settings } = await pageContext();
  const id = Number((await params).id);
  const c = Number.isInteger(id) ? getCustomer(db, id) : null;
  if (!c) notFound();
  const quotations = listDocuments(db, "quotation", { customerId: id });
  const invoices = listDocuments(db, "invoice", { customerId: id });
  const followUps = listFollowUps(db, { customerId: id });
  const activity = recentActivity(db, { customerId: id, limit: 10 });
  const balance = customerBalances(db, id).get(id) ?? {};
  const paid: Partial<Record<"BDT" | "USD", number>> = {};
  for (const i of invoices) paid[i.currency] = (paid[i.currency] ?? 0) + i.amountPaid;

  const detail = (label: string, value: string) =>
    value ? (
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-800">{value}</dd>
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={c.company}
        actions={
          <>
            {!c.archivedAt && (
              <>
                <LinkButton href={`/quotations/new?customer=${c.id}`} variant="secondary">
                  {t.documents.newQuotation}
                </LinkButton>
                <LinkButton href={`/invoices/new?customer=${c.id}`} variant="secondary">
                  {t.documents.newInvoice}
                </LinkButton>
              </>
            )}
            <LinkButton href={`/customers/${c.id}/edit`}>{t.common.edit}</LinkButton>
          </>
        }
      />
      <div className="space-y-6">
        {c.archivedAt && <Alert tone="warning">{t.customers.archivedNotice}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={t.customers.outstanding} value={<MoneyLines lines={fmt.moneyLines(balance, settings.defaultCurrency)} />} tone={Object.keys(balance).length ? "red" : undefined} />
          <StatCard label={t.dashboard.paid} value={<MoneyLines lines={fmt.moneyLines(paid, settings.defaultCurrency)} />} tone="green" />
          <StatCard label={t.customers.documents} value={`${fmt.number(quotations.length)} / ${fmt.number(invoices.length)}`} sub={`${t.nav.quotations} / ${t.nav.invoices}`} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title={t.customers.contact}>
            <dl className="space-y-3">
              {detail(t.customers.email, c.email)}
              {detail(t.customers.phone, c.phone)}
              {detail(t.customers.address, [c.address, c.city, c.country].filter(Boolean).join("\n"))}
              {detail(t.customers.taxId, c.taxId)}
              {detail(t.customers.notes, c.notes)}
            </dl>
            <form action={archiveCustomerAction} className="mt-5 border-t border-slate-100 pt-4">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="archive" value={c.archivedAt ? "0" : "1"} />
              <Button variant={c.archivedAt ? "secondary" : "danger"} type="submit">
                {c.archivedAt ? t.customers.restore : t.customers.archive}
              </Button>
            </form>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card title={t.nav.invoices} padded={false}>
              {invoices.length ? <DocumentTable rows={invoices} t={t} fmt={fmt} showCustomer={false} /> : <p className="px-4 py-6 text-sm text-slate-500">{t.documents.emptyInvoices}</p>}
            </Card>
            <Card title={t.nav.quotations} padded={false}>
              {quotations.length ? <DocumentTable rows={quotations} t={t} fmt={fmt} showCustomer={false} /> : <p className="px-4 py-6 text-sm text-slate-500">{t.documents.emptyQuotations}</p>}
            </Card>
            <Card title={t.followUps.title} padded={false}>
              <FollowUpList items={followUps} t={t} fmt={fmt} />
              <div className="border-t border-slate-100 p-4">
                <FollowUpForm customers={customerOptions(db, c.id)} defaultCustomerId={c.id} defaultDate={todayIso()} compact />
              </div>
            </Card>
            <Card title={t.customers.activity} padded={false}>
              {activity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">{t.dashboard.noActivity}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {activity.map((a) => (
                    <li key={a.id} className="flex flex-col px-4 py-2.5 text-sm sm:flex-row sm:justify-between sm:gap-4">
                      <span className="text-slate-700">{a.message}</span>
                      <time className="shrink-0 text-xs text-slate-500">{fmt.dateTime(a.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
