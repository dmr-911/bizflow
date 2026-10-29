import { DocumentNewPage } from "@/components/document-pages";

export const metadata = { title: "New quotation" };

export default function Page({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  return <DocumentNewPage kind="quotation" searchParams={searchParams} />;
}
