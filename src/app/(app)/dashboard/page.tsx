import Link from "next/link";
import { Icon } from "@/components/icons";
import { RevenueChart } from "@/components/revenue-chart";
import { Alert, Card, EmptyState, LinkButton, MoneyLines, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { interpolate } from "@/lib/i18n";
import { recentActivity } from "@/lib/services/activity";
import { reminderCounts, upcomingFollowUps } from "@/lib/services/followups";
import { dashboardStats, revenueByMonth } from "@/lib/services/reports";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ demo?: string; welcome?: string }> }) {
  const { db, settings, t, fmt } = await pageContext();
  const sp = await searchParams;
  const cur = settings.defaultCurrency;
  const [stats, months, activity, upcoming, reminders] = await Promise.all([
    dashboardStats(db),
    revenueByMonth(db, { months: 6, currency: cur }),
    recentActivity(db, { limit: 8 }),
    upcomingFollowUps(db, 7),
    reminderCounts(db),
  ]);
  const followUps = upcoming.slice(0, 6);
  const isEmpty = stats.invoiceCount === 0 && stats.quotationCount === 0 && activity.length === 0;

  return (
    <>
      <PageHeader
        title={t.dashboard.title}
        subtitle={t.dashboard.welcome}
        actions={
          <>
            <LinkButton href="/quotations/new" variant="secondary">
              <Icon name="plus" className="size-4" />
              {t.dashboard.newQuotation}
            </LinkButton>
            <LinkButton href="/invoices/new">
              <Icon name="plus" className="size-4" />
              {t.dashboard.newInvoice}
            </LinkButton>
          </>
        }
      />

      <div className="space-y-6">
        {sp.welcome && <Alert tone="success">{t.dashboard.welcomeNew}</Alert>}
        {sp.demo && <Alert tone="success">{t.settings.demoLoaded}</Alert>}
        {reminders.overdue + reminders.dueToday > 0 && (
          <Alert tone="warning">
            <span className="flex flex-wrap items-center gap-2">
              <Icon name="bell" className="size-4" />
              {interpolate(t.followUps.reminderBanner, { overdue: fmt.number(reminders.overdue), today: fmt.number(reminders.dueToday) })}
              <Link href="/follow-ups?filter=overdue" className="font-medium underline">
                {t.followUps.view}
              </Link>
            </span>
          </Alert>
        )}

        {isEmpty && (
          <Card>
            <EmptyState
              icon="🚀"
              title={t.dashboard.gettingStarted}
              text={t.dashboard.gettingStartedText}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <LinkButton href="/customers/new">{t.dashboard.addCustomer}</LinkButton>
                  <LinkButton href="/settings" variant="secondary">
                    {t.nav.settings}
                  </LinkButton>
                </div>
              }
            />
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t.dashboard.invoices} value={fmt.number(stats.invoiceCount)} sub={`${fmt.number(stats.overdueCount)} ${t.dashboard.overdueInvoices}`} />
          <StatCard label={t.dashboard.quotations} value={fmt.number(stats.quotationCount)} sub={`${fmt.number(stats.openQuotationCount)} ${t.dashboard.openQuotations}`} />
          <StatCard
            label={t.dashboard.paid}
            tone="green"
            value={<MoneyLines lines={fmt.moneyLines(stats.paid, cur)} />}
            sub={`${fmt.moneyByCurrency(stats.paidThisMonth, cur)} ${t.dashboard.paidThisMonth}`}
          />
          <StatCard
            label={t.dashboard.outstanding}
            tone={stats.overdueCount ? "red" : undefined}
            value={<MoneyLines lines={fmt.moneyLines(stats.outstanding, cur)} />}
            sub={`${fmt.moneyByCurrency(stats.overdue, cur)} ${t.dashboard.overdue}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card title={`${t.dashboard.monthlyRevenue} (${cur})`} className="lg:col-span-3" actions={<Link href="/reports" className="text-sm text-brand-600 hover:underline">{t.nav.reports} →</Link>}>
            <RevenueChart rows={months} fmt={fmt} labels={{ invoiced: t.dashboard.invoiced, received: t.dashboard.received }} />
          </Card>

          <Card title={t.dashboard.upcomingFollowUps} className="lg:col-span-2" padded={false} actions={<Link href="/follow-ups" className="text-sm text-brand-600 hover:underline">{t.common.view} →</Link>}>
            {followUps.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">{t.dashboard.noFollowUps}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {followUps.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{f.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {fmt.date(f.dueDate)}
                        {f.customerName && ` · ${f.customerName}`}
                      </p>
                    </div>
                    <StatusBadge status={f.displayStatus} label={t.status[f.displayStatus]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title={t.dashboard.recentActivity} padded={false}>
          {activity.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">{t.dashboard.noActivity}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="text-sm text-slate-700">
                    {a.documentId && a.documentKind ? (
                      <Link href={`/${a.documentKind === "quotation" ? "quotations" : "invoices"}/${a.documentId}`} className="hover:underline">
                        {a.message}
                      </Link>
                    ) : a.customerId ? (
                      <Link href={`/customers/${a.customerId}`} className="hover:underline">
                        {a.message}
                      </Link>
                    ) : (
                      a.message
                    )}
                  </p>
                  <time className="shrink-0 text-xs text-slate-500" dateTime={a.createdAt}>
                    {fmt.dateTime(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
