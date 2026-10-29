import { toBanglaDigits } from "./money";

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_BN = ["জানু", "ফেব্রু", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টে", "অক্টো", "নভে", "ডিসে"];

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date as YYYY-MM-DD in the server's local time zone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function formatDate(iso: string | null | undefined, format: DateFormat, locale: "en" | "bn" = "en"): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  let out: string;
  switch (format) {
    case "MM/DD/YYYY":
      out = `${m}/${d}/${y}`;
      break;
    case "YYYY-MM-DD":
      out = `${y}-${m}-${d}`;
      break;
    case "DD MMM YYYY":
      out = `${d} ${(locale === "bn" ? MONTHS_BN : MONTHS_EN)[Number(m) - 1]} ${y}`;
      break;
    default:
      out = `${d}/${m}/${y}`;
  }
  return locale === "bn" ? toBanglaDigits(out) : out;
}

/** "2026-10" -> "Oct 2026" */
export function formatMonth(ym: string, locale: "en" | "bn" = "en"): string {
  const [y, m] = ym.split("-");
  const out = `${(locale === "bn" ? MONTHS_BN : MONTHS_EN)[Number(m) - 1]} ${y}`;
  return locale === "bn" ? toBanglaDigits(out) : out;
}

/** List of YYYY-MM keys ending at the month of `endIso`, oldest first. */
export function lastMonths(endIso: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endIso, -i).slice(0, 7));
  return out;
}
