import { DocumentEditPage } from "@/components/document-pages";

export const metadata = { title: "Edit invoice" };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentEditPage kind="invoice" params={params} />;
}
