import type { ReactNode } from "react";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Brand } from "./brand";
import { Icon } from "./icons";
import { LocaleSwitch } from "./locale-switch";

/** Split layout for sign in, sign up and password pages: form on the left, product promise on the right. */
export function AuthShell({
  t,
  locale,
  title,
  text,
  children,
  footer,
}: {
  t: Dictionary;
  locale: Locale;
  title: string;
  text: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Brand />
          <LocaleSwitch locale={locale} />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-sm text-slate-600">{footer}</div>}
          </div>
        </main>
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Icon name="shield" className="size-3.5" />
          {t.auth.secureNote}
        </p>
      </div>
      <aside className="relative hidden overflow-hidden bg-brand-700 lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-center px-12 xl:px-20">
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">{t.auth.asideTitle}</p>
          <ul className="mt-8 space-y-4">
            {t.auth.asidePoints.split("|").map((p) => (
              <li key={p} className="flex items-start gap-3 text-brand-50">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Icon name="check" className="size-3.5 text-white" />
                </span>
                <span className="text-base">{p}</span>
              </li>
            ))}
          </ul>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/screens/dashboard.png" alt="" className="mt-12 w-full max-w-xl rounded-xl border border-white/20 shadow-2xl" />
        </div>
      </aside>
    </div>
  );
}
