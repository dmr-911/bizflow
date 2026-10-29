import { notFound } from "next/navigation";
import { CustomerForm } from "@/components/customer-form";
import { Card, PageHeader } from "@/components/ui";
import { getCustomer } from "@/lib/services/customers";
import { pageContext } from "@/lib/server/context";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, t } = await pageContext();
  const c = getCustomer(db, Number((await params).id));
  if (!c) notFound();
  const { id, archivedAt, createdAt, updatedAt, ...values } = c;
  void archivedAt; void createdAt; void updatedAt;
  return (
    <>
      <PageHeader title={t.customers.edit} subtitle={c.name} />
      <Card className="max-w-3xl">
        <CustomerForm id={id} initial={values} />
      </Card>
    </>
  );
}
