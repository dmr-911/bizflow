import Link from "next/link";
import { notFound } from "next/navigation";
import {
  convertQuotationAction,
  deleteDraftAction,
  deletePaymentAction,
  invoiceStatusAction,
  quotationStatusAction,
} from "@/app/actions/documents";
import { addDays, todayIso } from "@/lib/dates";
import { minorToDecimalString } from "@/lib/money";
import { customerOptions, getCustomer } from "@/lib/services/customers";
import { getDocument, listDocuments, type DocumentDetail, type DocumentKind } from "@/lib/services/documents";
import { listFollowUps } from "@/lib/services/followups";
import { isInvoiceEditable, isQuotationEditable, type InvoiceStatus, type QuotationStatus } from "@/lib/status";
import type { DocumentFormValues, Settings } from "@/lib/validation";
import { pageContext } from "@/lib/server/context";
import { ConfirmButton } from "./confirm-button";
import { DocumentForm } from "./document-form";
import { DocumentSheet } from "./document-sheet";
import { DocumentTable } from "./document-table";
import { FollowUpForm, FollowUpList } from "./follow-ups";
import { Icon } from "./icons";
import { PaymentForm } from "./payment-form";
import { Alert, Button, Card, EmptyState, FilterTabs, Input, LinkButton, PageHeader } from "./ui";

const path = (kind: DocumentKind) => (kind === "invoice" ? "/invoices" : "/quotations");

const FILTERS: Record<DocumentKind, string[]> = {
  invoice: ["all", "draft", "sent", "partially_paid", "overdue", "paid", "cancelled"],
  quotation: ["all", "draft", "sent", "accepted", "expired", "rejected", "converted"],
};

// ---------- List ----------

export async function DocumentListPage({ kind, searchParams }: { kind: DocumentKind; searchParams: Promise<{ status?: string; q?: string }> }) {
  const { db, t, fmt } = await pageContext();
  const { status = "all", q = "" } = await searchParams;
  const filter = FILTERS[kind].includes(status) ? status : "all";
  const all = await listDocuments(db, kind, { search: q });
  const rows = filter === "all" ? all : all.filter((r) => r.displayStatus === filter);
  const count = (s: string) => (s === "all" ? all.length : all.filter((r) => r.displayStatus === s).length);
  const href = (s: string) => `${path(kind)}?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const isInvoice = kind === "invoice";

  return (
    <>
      <PageHeader
        title={isInvoice ? t.nav.invoices : t.nav.quotations}
        actions={
          <>
            <LinkButton href={`/api/export/${isInvoice ? "invoices" : "quotations"}`} variant="secondary" prefetch={false}>
              <Icon name="download" className="size-4" />
              {t.common.exportCsv}
            </LinkButton>
            <LinkButton href={`${path(kind)}/new`}>
              <Icon name="plus" className="size-4" />
              {isInvoice ? t.documents.newInvoice : t.documents.newQuotation}
            </LinkButton>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
          <FilterTabs items={FILTERS[kind].map((s) => ({ href: href(s), label: s === "all" ? t.common.all : t.status[s as keyof typeof t.status], active: s === filter, count: count(s) }))} />
          <form className="w-full xl:w-72" role="search">
            <input type="hidden" name="status" value={filter} />
            <label htmlFor="q" className="sr-only">
              {t.common.search}
            </label>
            <Input id="q" name="q" type="search" defaultValue={q} placeholder={t.documents.searchPlaceholder} />
          </form>
        </div>
        {rows.length === 0 ? (
          all.length === 0 && !q ? (
            <EmptyState
              icon={isInvoice ? "🧾" : "📝"}
              title={isInvoice ? t.documents.emptyInvoices : t.documents.emptyQuotations}
              text={isInvoice ? t.documents.emptyInvoicesText : t.documents.emptyQuotationsText}
              action={<LinkButton href={`${path(kind)}/new`}>{isInvoice ? t.documents.newInvoice : t.documents.newQuotation}</LinkButton>}
            />
          ) : (
            <EmptyState icon="🔍" title={t.common.noResults} />
          )
        ) : (
          <DocumentTable rows={rows} t={t} fmt={fmt} />
        )}
      </Card>
    </>
  );
}

// ---------- New / edit ----------

function defaultItem(settings: Settings): DocumentFormValues["items"][number] {
  return {
    description: "",
    quantity: "1",
    unitPrice: "",
    discountType: "percent",
    discountValue: "0",
    taxRateId: settings.taxRates.find((r) => r.isDefault)?.id ?? "",
  };
}

function toFormValues(doc: DocumentDetail, settings: Settings): DocumentFormValues {
  return {
    customerId: doc.customerId,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate ?? "",
    currency: doc.currency,
    notes: doc.notes,
    terms: doc.terms,
    items: doc.items.map((i) => ({
      description: i.description,
      quantity: String(i.quantityMilli / 1000),
      unitPrice: minorToDecimalString(i.unitPrice, doc.currency),
      discountType: i.discountType,
      discountValue: i.discountType === "percent" ? String(i.discountValue / 100) : minorToDecimalString(i.discountValue, doc.currency),
      taxRateId:
        settings.taxRates.find((r) => r.rateBps === i.taxRateBps && (r.name === i.taxName || i.taxRateBps === 0))?.id ??
        settings.taxRates.find((r) => r.rateBps === i.taxRateBps)?.id ??
        "",
    })),
  };
}

export async function DocumentNewPage({ kind, searchParams }: { kind: DocumentKind; searchParams: Promise<{ customer?: string }> }) {
  const { db, t, settings } = await pageContext();
  const { customer } = await searchParams;
  const customers = await customerOptions(db);
  const today = todayIso();
  const isInvoice = kind === "invoice";
  const initial: DocumentFormValues = {
    customerId: customer && customers.some((c) => c.id === Number(customer)) ? Number(customer) : ("" as unknown as number),
    issueDate: today,
    dueDate: addDays(today, isInvoice ? settings.paymentTermsDays : settings.quotationValidityDays),
    currency: settings.defaultCurrency,
    notes: "",
    terms: isInvoice ? settings.invoiceTerms : settings.quotationTerms,
    items: [defaultItem(settings)],
  };
  return (
    <>
      <PageHeader title={isInvoice ? t.documents.newInvoice : t.documents.newQuotation} />
      {customers.length === 0 ? (
        <Card>
          <EmptyState icon="👥" title={t.customers.empty} text={t.customers.emptyText} action={<LinkButton href="/customers/new">{t.customers.new}</LinkButton>} />
        </Card>
      ) : (
        <Card>
          <DocumentForm kind={kind} id={null} initial={initial} customers={customers} taxRates={settings.taxRates} cancelHref={path(kind)} />
        </Card>
      )}
    </>
  );
}

export async function DocumentEditPage({ kind, params }: { kind: DocumentKind; params: Promise<{ id: string }> }) {
  const { db, t, settings } = await pageContext();
  const doc = await getDocument(db, Number((await params).id));
  if (!doc || doc.kind !== kind) notFound();
  const customers = await customerOptions(db, doc.customerId);
  const editable = kind === "invoice" ? isInvoiceEditable(doc.status as InvoiceStatus) : isQuotationEditable(doc.status as QuotationStatus);
  return (
    <>
      <PageHeader title={kind === "invoice" ? t.documents.editInvoice : t.documents.editQuotation} subtitle={doc.number} />
      <Card>
        {editable ? (
          <DocumentForm kind={kind} id={doc.id} initial={toFormValues(doc, settings)} customers={customers} taxRates={settings.taxRates} cancelHref={`${path(kind)}/${doc.id}`} />
        ) : (
          <Alert tone="warning">{t.documents.lockedNotice}</Alert>
        )}
      </Card>
    </>
  );
}

// ---------- Detail ----------

function ActionForm({ action, id, to, children }: { action: (f: FormData) => Promise<void>; id: number; to?: string; children: React.ReactNode }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {to && <input type="hidden" name="to" value={to} />}
      {children}
    </form>
  );
}

export async function DocumentDetailPage({ kind, params, searchParams }: { kind: DocumentKind; params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { db, t, fmt, settings } = await pageContext();
  const doc = await getDocument(db, Number((await params).id));
  if (!doc || doc.kind !== kind) notFound();
  const { error } = await searchParams;
  const [found, allFollowUps] = await Promise.all([getCustomer(db, doc.customerId), listFollowUps(db, {})]);
  const customer = found!;
  const followUps = allFollowUps.filter((f) => f.documentId === doc.id);
  const isInvoice = kind === "invoice";
  const s = doc.status;
  const editable = isInvoice ? isInvoiceEditable(s as InvoiceStatus) : isQuotationEditable(s as QuotationStatus);

  const actions = (
    <>
      <LinkButton href={`/print/${kind}/${doc.id}`} variant="secondary" target="_blank" prefetch={false}>
        <Icon name="print" className="size-4" />
        {t.common.print}
      </LinkButton>
      {editable && (
        <LinkButton href={`${path(kind)}/${doc.id}/edit`} variant="secondary">
          {t.common.edit}
        </LinkButton>
      )}
      {isInvoice ? (
        <>
          {s === "draft" && (
            <ActionForm action={invoiceStatusAction} id={doc.id} to="sent">
              <Button type="submit">{t.documents.markSent}</Button>
            </ActionForm>
          )}
          {s === "sent" && (
            <ActionForm action={invoiceStatusAction} id={doc.id} to="draft">
              <Button type="submit" variant="secondary">
                {t.documents.backToDraft}
              </Button>
            </ActionForm>
          )}
          {(s === "draft" || s === "sent") && (
            <ActionForm action={invoiceStatusAction} id={doc.id} to="cancelled">
              <ConfirmButton variant="danger" message={t.documents.cancelConfirm}>
                {t.documents.cancelInvoice}
              </ConfirmButton>
            </ActionForm>
          )}
        </>
      ) : (
        <>
          {s === "draft" && (
            <ActionForm action={quotationStatusAction} id={doc.id} to="sent">
              <Button type="submit">{t.documents.markSent}</Button>
            </ActionForm>
          )}
          {(s === "draft" || s === "sent") && (
            <ActionForm action={quotationStatusAction} id={doc.id} to="accepted">
              <Button type="submit" variant={s === "sent" ? "primary" : "secondary"}>
                {t.documents.markAccepted}
              </Button>
            </ActionForm>
          )}
          {(s === "draft" || s === "sent" || s === "accepted") && (
            <ActionForm action={quotationStatusAction} id={doc.id} to="rejected">
              <Button type="submit" variant="danger">
                {t.documents.markRejected}
              </Button>
            </ActionForm>
          )}
          {s === "rejected" && (
            <ActionForm action={quotationStatusAction} id={doc.id} to="draft">
              <Button type="submit" variant="secondary">
                {t.documents.backToDraft}
              </Button>
            </ActionForm>
          )}
          {s === "accepted" && (
            <ActionForm action={convertQuotationAction} id={doc.id}>
              <Button type="submit">{t.documents.convert}</Button>
            </ActionForm>
          )}
        </>
      )}
      {s === "draft" && !(kind === "quotation" && doc.linked) && (
        <ActionForm action={deleteDraftAction} id={doc.id}>
          <ConfirmButton variant="ghost" message={t.documents.deleteConfirm}>
            <Icon name="trash" className="size-4" />
            {t.documents.deleteDraft}
          </ConfirmButton>
        </ActionForm>
      )}
    </>
  );

  return (
    <>
      <div className="no-print mb-2 text-sm">
        <Link href={path(kind)} className="text-slate-500 hover:text-slate-800">
          ← {isInvoice ? t.nav.invoices : t.nav.quotations}
        </Link>
      </div>
      <PageHeader
        title={doc.number}
        subtitle={
          <Link href={`/customers/${customer.id}`} className="hover:underline">
            {customer.name}
            {customer.company ? ` · ${customer.company}` : ""}
          </Link>
        }
        actions={actions}
      />

      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}
        {doc.linked && (
          <Alert tone="info">
            {isInvoice ? t.documents.createdFrom : t.documents.convertedTo}:{" "}
            <Link className="font-medium underline" href={`${path(doc.linked.kind)}/${doc.linked.id}`}>
              {doc.linked.number}
            </Link>
          </Alert>
        )}
        {isInvoice && !editable && s !== "cancelled" && s !== "paid" && <p className="text-xs text-slate-500">{t.documents.lockedNotice}</p>}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <DocumentSheet doc={doc} customer={customer} settings={settings} t={t} fmt={fmt} />
          </div>

          <div className="space-y-6">
            {isInvoice && (
              <Card title={t.payments.title} padded={false}>
                {doc.payments.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-500">{t.payments.none}</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {doc.payments.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="tabular font-medium text-slate-900">{fmt.money(p.amount, doc.currency)}</p>
                          <p className="text-xs text-slate-500">
                            {fmt.date(p.paidAt)} · {t.payments.methods[p.method as keyof typeof t.payments.methods] ?? p.method}
                            {p.reference && ` · ${p.reference}`}
                          </p>
                        </div>
                        {s !== "cancelled" && (
                          <form action={deletePaymentAction}>
                            <input type="hidden" name="paymentId" value={p.id} />
                            <input type="hidden" name="invoiceId" value={doc.id} />
                            <ConfirmButton variant="ghost" className="px-2 py-1 text-xs" message={t.payments.removeConfirm} aria-label={t.payments.remove} title={t.payments.remove}>
                              <Icon name="trash" className="size-3.5" />
                            </ConfirmButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {(s === "sent" || s === "partially_paid") && (
                  <div className="border-t border-slate-100 p-4">
                    <PaymentForm invoiceId={doc.id} balance={doc.balance} currency={doc.currency} today={todayIso()} />
                  </div>
                )}
                {s === "draft" && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{t.documents.markSent} → {t.payments.record}</p>}
              </Card>
            )}

            <Card title={t.followUps.title} padded={false}>
              <FollowUpList items={followUps} t={t} fmt={fmt} />
              <div className="border-t border-slate-100 p-4">
                <FollowUpForm customers={[]} defaultCustomerId={doc.customerId} documentId={doc.id} defaultDate={addDays(todayIso(), 3)} compact />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
