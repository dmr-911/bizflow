import { DocumentNewPage } from "@/components/document-pages";

export const metadata = { title: "New invoice" };

export default function Page({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  return <DocumentNewPage kind="invoice" searchParams={searchParams} />;
}
