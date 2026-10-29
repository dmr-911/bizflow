import { DocumentDetailPage } from "@/components/document-pages";

export const metadata = { title: "Invoice" };

export default function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  return <DocumentDetailPage kind="invoice" {...props} />;
}
