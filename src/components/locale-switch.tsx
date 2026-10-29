import { setLocaleAction } from "@/app/actions/settings";
import type { Locale } from "@/lib/i18n";
import { cx } from "./ui";

/** Plain form buttons so it works before (and without) JavaScript. */
export function LocaleSwitch({ locale, className }: { locale: Locale; className?: string }) {
  const option = (value: Locale, label: string) => (
    <button
      name="locale"
      value={value}
      aria-pressed={locale === value}
      lang={value}
      className={cx(
        "rounded-md px-2.5 py-1 text-xs font-medium transition",
        locale === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
      )}
    >
      {label}
    </button>
  );
  return (
    <form action={setLocaleAction} className={cx("inline-flex rounded-lg bg-slate-100 p-0.5", className)} aria-label="Language">
      {option("en", "English")}
      {option("bn", "বাংলা")}
    </form>
  );
}
