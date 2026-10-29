import { redirect } from "next/navigation";
import { I18nProvider } from "@/components/i18n-provider";
import { Sidebar } from "@/components/sidebar";
import { hasUsers } from "@/lib/services/auth";
import { reminderCounts } from "@/lib/services/followups";
import { currentUser, getContext } from "@/lib/server/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, settings, t } = await getContext();
  if (!hasUsers(db)) redirect("/setup");
  const user = await currentUser();
  if (!user) redirect("/login");
  const r = reminderCounts(db);
  return (
    <I18nProvider dict={t} prefs={{ locale: settings.locale, dateFormat: settings.dateFormat }}>
      <Sidebar businessName={settings.business.name} username={user.username} reminders={r.overdue + r.dueToday} />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </I18nProvider>
  );
}
