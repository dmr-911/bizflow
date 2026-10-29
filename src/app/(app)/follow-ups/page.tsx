import { FollowUpForm, FollowUpList } from "@/components/follow-ups";
import { Card, EmptyState, FilterTabs, PageHeader } from "@/components/ui";
import { todayIso } from "@/lib/dates";
import { customerOptions } from "@/lib/services/customers";
import { listFollowUps } from "@/lib/services/followups";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "Follow-ups" };

const FILTERS = ["all", "pending", "overdue", "completed"] as const;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { db, t, fmt } = await pageContext();
  const raw = (await searchParams).filter;
  const filter = (FILTERS as readonly string[]).includes(raw ?? "") ? (raw as (typeof FILTERS)[number]) : "all";
  const items = listFollowUps(db, { filter });
  const counts = Object.fromEntries(FILTERS.map((f) => [f, listFollowUps(db, { filter: f }).length]));
  const labels = { all: t.common.all, pending: t.status.pending, overdue: t.status.overdue, completed: t.status.completed };

  return (
    <>
      <PageHeader title={t.followUps.title} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="border-b border-slate-100 p-4">
            <FilterTabs items={FILTERS.map((f) => ({ href: `/follow-ups?filter=${f}`, label: labels[f], active: f === filter, count: counts[f] }))} />
          </div>
          {items.length === 0 ? <EmptyState icon="⏰" title={t.followUps.empty} text={t.followUps.emptyText} /> : <FollowUpList items={items} t={t} fmt={fmt} showCustomer />}
        </Card>
        <Card>
          <FollowUpForm customers={customerOptions(db)} defaultDate={todayIso()} />
        </Card>
      </div>
    </>
  );
}
