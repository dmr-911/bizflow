import { DocumentListPage } from "@/components/document-pages";

export const metadata = { title: "Quotations" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  return <DocumentListPage kind="quotation" searchParams={searchParams} />;
}
