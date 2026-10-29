import { DocumentListPage } from "@/components/document-pages";

export const metadata = { title: "Invoices" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  return <DocumentListPage kind="invoice" searchParams={searchParams} />;
}
