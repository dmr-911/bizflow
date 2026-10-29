import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentSheet } from "@/components/document-sheet";
import { PrintButton } from "@/components/print-button";
import { getCustomer } from "@/lib/services/customers";
import { getDocument } from "@/lib/services/documents";
import { pageContext } from "@/lib/server/context";

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { db } = await pageContext();
  const doc = getDocument(db, Number((await params).id));
  // The title becomes the default PDF file name in most browsers.
  return { title: { absolute: doc ? `${doc.number} - ${doc.customerName}` : "Print" } };
}

export default async function PrintPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { db, t, fmt, settings } = await pageContext();
  const { kind, id } = await params;
  const doc = getDocument(db, Number(id));
  if (!doc || doc.kind !== kind) notFound();
  const customer = getCustomer(db, doc.customerId)!;
  const back = `/${doc.kind === "invoice" ? "invoices" : "quotations"}/${doc.id}`;
  return (
    <div className="min-h-screen bg-slate-100 px-2 py-6 print:bg-white print:p-0 sm:px-4">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
        <Link href={back} className="text-sm text-slate-600 hover:text-slate-900">
          ← {t.common.back}
        </Link>
        <PrintButton label={t.common.print} auto={(await searchParams).auto === "1"} />
      </div>
      <DocumentSheet doc={doc} customer={customer} settings={settings} t={t} fmt={fmt} />
    </div>
  );
}
