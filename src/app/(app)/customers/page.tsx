import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, FilterTabs, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { listCustomers } from "@/lib/services/customers";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const { db, t, fmt, settings } = await pageContext();
  const { q = "", view = "active" } = await searchParams;
  const archived = view === "archived";
  const rows = await listCustomers(db, { search: q, archivedOnly: archived });
  const qs = (v: string) => `/customers?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader
        title={t.customers.title}
        actions={
          <>
            <LinkButton href="/api/export/customers" variant="secondary" prefetch={false}>
              <Icon name="download" className="size-4" />
              {t.common.exportCsv}
            </LinkButton>
            <LinkButton href="/customers/new">
              <Icon name="plus" className="size-4" />
              {t.customers.new}
            </LinkButton>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs
            items={[
              { href: qs("active"), label: t.customers.active, active: !archived },
              { href: qs("archived"), label: t.customers.showArchived, active: archived },
            ]}
          />
          <form className="flex w-full gap-2 sm:w-80" role="search">
            <input type="hidden" name="view" value={view} />
            <label htmlFor="q" className="sr-only">
              {t.common.search}
            </label>
            <Input id="q" name="q" defaultValue={q} placeholder={t.customers.searchPlaceholder} type="search" />
          </form>
        </div>
        {rows.length === 0 ? (
          q ? (
            <EmptyState icon="🔍" title={t.common.noResults} />
          ) : (
            <EmptyState
              icon="👥"
              title={t.customers.empty}
              text={t.customers.emptyText}
              action={!archived && <LinkButton href="/customers/new">{t.customers.new}</LinkButton>}
            />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.customers.name}</Th>
                <Th className="hidden md:table-cell">{t.customers.contact}</Th>
                <Th className="hidden sm:table-cell text-right">{t.customers.documents}</Th>
                <Th className="text-right">{t.customers.outstanding}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {c.name}
                    </Link>
                    {c.company && <p className="text-xs text-slate-500">{c.company}</p>}
                    {c.archivedAt && <Badge>{t.customers.archived}</Badge>}
                  </Td>
                  <Td className="hidden md:table-cell">
                    <p>{c.email}</p>
                    <p className="text-xs text-slate-500">{c.phone}</p>
                  </Td>
                  <Td className="tabular hidden text-right sm:table-cell">
                    {fmt.number(c.quotationCount)} / {fmt.number(c.invoiceCount)}
                  </Td>
                  <Td className="tabular text-right">{Object.keys(c.outstanding).length ? fmt.moneyByCurrency(c.outstanding, settings.defaultCurrency) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
