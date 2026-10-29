import type { Metadata } from "next";
import { I18nProvider } from "@/components/i18n-provider";
import { Sidebar } from "@/components/sidebar";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { reminderCounts } from "@/lib/services/followups";
import { accountContext } from "@/lib/server/context";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Pages check the subscription themselves; billing and account pages must stay reachable when it lapses.
  const { db, settings, t, user, access } = await accountContext();
  const r = access.allowed ? reminderCounts(db) : { overdue: 0, dueToday: 0 };
  return (
    <I18nProvider dict={t} prefs={{ locale: settings.locale, dateFormat: settings.dateFormat }}>
      <Sidebar businessName={settings.business.name} username={user.email} reminders={r.overdue + r.dueToday} />
      <main className="lg:pl-64">
        <SubscriptionBanner access={access} t={t} />
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </I18nProvider>
  );
}
