import Link from "next/link";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Brand } from "../brand";
import { LocaleSwitch } from "../locale-switch";
import { LinkButton } from "../ui";

export function SiteHeader({ t, locale, signedIn, anchors = true }: { t: Dictionary; locale: Locale; signedIn: boolean; anchors?: boolean }) {
  const m = t.marketing.nav;
  const links = [
    { href: "/#features", label: m.features },
    { href: "/#how", label: m.how },
    { href: "/#pricing", label: m.pricing },
    { href: "/#faq", label: m.faq },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        {anchors && (
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex" aria-label="Primary">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="transition hover:text-slate-900">
                {l.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitch locale={locale} className="hidden sm:inline-flex" />
          {signedIn ? (
            <LinkButton href="/dashboard">{m.dashboard}</LinkButton>
          ) : (
            <>
              <Link href="/login" className="hidden px-2 text-sm font-medium text-slate-700 hover:text-slate-900 sm:block">
                {t.auth.login}
              </Link>
              <LinkButton href="/signup">{m.start}</LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
