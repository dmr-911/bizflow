import { formatDate, formatMonth, type DateFormat } from "./dates";
import type { Locale } from "./i18n";
import { formatMoney, toBanglaDigits, type Currency } from "./money";
import type { ByCurrency } from "./services/reports";

export interface FormatPrefs {
  locale: Locale;
  dateFormat: DateFormat;
}

/** Pure formatting helpers usable on server and client. */
export function makeFormatter(p: FormatPrefs) {
  return {
    money: (minor: number, currency: Currency) => formatMoney(minor, currency, p.locale),
    /** Render { BDT: 100, USD: 5 } as "৳1.00 · $0.05"; empty as a zero in the fallback currency. */
    moneyByCurrency: (v: ByCurrency, fallback: Currency) => {
      const entries = Object.entries(v).filter(([, a]) => a) as [Currency, number][];
      if (entries.length === 0) return formatMoney(0, fallback, p.locale);
      return entries.map(([c, a]) => formatMoney(a, c, p.locale)).join(" · ");
    },
    /** Same as moneyByCurrency but one string per currency, for stacked display. */
    moneyLines: (v: ByCurrency, fallback: Currency) => {
      const entries = Object.entries(v).filter(([, a]) => a) as [Currency, number][];
      return entries.length === 0 ? [formatMoney(0, fallback, p.locale)] : entries.map(([c, a]) => formatMoney(a, c, p.locale));
    },
    date: (iso: string | null | undefined) => formatDate(iso, p.dateFormat, p.locale),
    dateTime: (iso: string) => {
      const d = new Date(iso);
      return new Intl.DateTimeFormat(p.locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d);
    },
    month: (ym: string) => formatMonth(ym, p.locale),
    number: (n: number) => (p.locale === "bn" ? toBanglaDigits(String(n)) : String(n)),
    quantity: (milli: number) => {
      const s = (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
      return p.locale === "bn" ? toBanglaDigits(s) : s;
    },
    percent: (bps: number) => {
      const s = `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
      return p.locale === "bn" ? toBanglaDigits(s) : s;
    },
  };
}

export type Formatter = ReturnType<typeof makeFormatter>;
