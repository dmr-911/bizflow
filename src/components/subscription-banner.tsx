import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import { interpolate } from "@/lib/i18n";
import type { AccessState } from "@/lib/services/billing";

/** Thin bar above every app page during the last week of a trial or while a renewal is overdue. */
export function SubscriptionBanner({ access, t }: { access: AccessState; t: Dictionary }) {
  let text: string | null = null;
  if (access.state === "trial" && access.daysLeft <= 7) {
    text = access.daysLeft <= 1 ? t.billing.bannerTrialLast : interpolate(t.billing.bannerTrial, { days: access.daysLeft });
  } else if (access.state === "grace") {
    text = t.billing.bannerGrace;
  }
  if (!text) return null;
  return (
    <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>{text}</span>
        <Link href="/billing" className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">
          {t.billing.bannerAction}
        </Link>
      </div>
    </div>
  );
}
