import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { currentUser, visitorLocale } from "@/lib/server/context";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const LEGAL_UPDATED = "29 October 2026";

/** Legal texts are written in English; the English version governs. */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const locale = await visitorLocale();
  const t = getDictionary(locale);
  return (
    <>
      <SiteHeader t={t} locale={locale} signedIn={!!(await currentUser())} anchors={false} />
      <main className="bg-white">
        <article lang="en" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: {LEGAL_UPDATED}</p>
          <div className="mt-10 space-y-6 text-[15px] leading-7 text-slate-700 [&_a]:font-medium [&_a]:text-brand-600 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter t={t} locale={locale} />
    </>
  );
}
