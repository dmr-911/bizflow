"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { setLocaleAction } from "@/app/actions/settings";
import { LOCALES } from "@/lib/i18n";
import { Icon, type IconName } from "./icons";
import { useI18n } from "./i18n-provider";
import { cx } from "./ui";

const NAV: { href: string; key: "dashboard" | "customers" | "quotations" | "invoices" | "followUps" | "reports" | "settings" | "billing"; icon: IconName }[] = [
  { href: "/dashboard", key: "dashboard", icon: "dashboard" },
  { href: "/customers", key: "customers", icon: "customers" },
  { href: "/quotations", key: "quotations", icon: "quotations" },
  { href: "/invoices", key: "invoices", icon: "invoices" },
  { href: "/follow-ups", key: "followUps", icon: "followUps" },
  { href: "/reports", key: "reports", icon: "reports" },
  { href: "/settings", key: "settings", icon: "settings" },
  { href: "/billing", key: "billing", icon: "billing" },
];

export function Sidebar({ businessName, username, reminders }: { businessName: string; username: string; reminders: number }) {
  const { t, prefs, fmt } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cx(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
            isActive(item.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          <Icon name={item.icon} />
          <span className="flex-1">{t.nav[item.key]}</span>
          {item.key === "followUps" && reminders > 0 && (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" aria-label={`${reminders} reminders`}>
              {fmt.number(reminders)}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="space-y-3 border-t border-slate-200 p-4">
      <form action={setLocaleAction} className="flex items-center gap-2">
        <label htmlFor="locale" className="sr-only">
          {t.nav.language}
        </label>
        <select
          id="locale"
          name="locale"
          defaultValue={prefs.locale}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          {LOCALES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <noscript>
          <button className="text-sm">OK</button>
        </noscript>
      </form>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate text-slate-500" title={username}>
          {username}
        </span>
        <form action={logoutAction}>
          <button className="flex items-center gap-1 text-slate-600 hover:text-slate-900">
            <Icon name="logout" className="size-4" />
            {t.nav.logout}
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2 px-6 py-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">B</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{t.app.name}</p>
        <p className="truncate text-xs text-slate-500">{businessName}</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">B</span>
          <span className="text-sm font-semibold">{businessName}</span>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label={t.nav.menu} aria-expanded={open}>
          <Icon name="menu" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label={t.common.cancel}>
                <Icon name="close" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>
    </>
  );
}
