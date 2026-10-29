import { DocumentDetailPage } from "@/components/document-pages";

export const metadata = { title: "Quotation" };

export default function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  return <DocumentDetailPage kind="quotation" {...props} />;
}
