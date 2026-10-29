import { CustomerForm } from "@/components/customer-form";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const { t } = await pageContext();
  return (
    <>
      <PageHeader title={t.customers.new} />
      <Card className="max-w-3xl">
        <CustomerForm id={null} />
      </Card>
    </>
  );
}
