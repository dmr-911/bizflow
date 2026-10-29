import { DocumentEditPage } from "@/components/document-pages";

export const metadata = { title: "Edit quotation" };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentEditPage kind="quotation" params={params} />;
}
