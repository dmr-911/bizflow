import { DataPanel } from "@/components/data-panel";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/server/context";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { t, settings } = await pageContext();
  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SettingsForm initial={settings} />
        </div>
        <DataPanel />
      </div>
    </>
  );
}
