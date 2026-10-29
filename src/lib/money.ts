/**
 * Money helpers.
 *
 * Every monetary amount in BizFlow is an integer number of minor units
 * (paisa for BDT, cents for USD). Floating point is never used for money:
 * user input is parsed from decimal strings and all arithmetic goes through
 * BigInt with explicit half-up rounding.
 */

export const CURRENCIES = ["BDT", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Minor-unit scale per currency. Both supported currencies use 2 decimals. */
export const CURRENCY_DECIMALS: Record<Currency, number> = { BDT: 2, USD: 2 };

/** Upper bound for a single amount (100 billion major units) to keep values far from unsafe integers. */
export const MAX_AMOUNT_MINOR = 100_000_000_000 * 100;

/**
 * Parse a user-entered decimal string ("1,250.5", "৳ 1200", "১২০০.৫০") into an integer
 * scaled by 10^scale. Returns null when the input is not a valid non-negative number
 * or has more decimals than the scale allows.
 */
export function parseScaled(input: string | number, scale: number): number | null {
  let s = typeof input === "number" ? String(input) : input;
  s = toAsciiDigits(s).replace(/[,\s৳$]/g, "").replace(/^(BDT|USD|Tk\.?)/i, "");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > scale) return null;
  const scaled = BigInt(whole) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, "0") || "0");
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(scaled);
}

/** Parse an amount in major units into minor units for the currency. */
export function parseMoney(input: string | number, currency: Currency = "BDT"): number | null {
  const v = parseScaled(input, CURRENCY_DECIMALS[currency]);
  if (v === null || v > MAX_AMOUNT_MINOR) return null;
  return v;
}

/** Render minor units as a plain decimal string (no grouping), e.g. 123456 -> "1234.56". */
export function minorToDecimalString(minor: number, currency: Currency = "BDT"): string {
  const d = CURRENCY_DECIMALS[currency];
  const neg = minor < 0;
  const abs = BigInt(Math.abs(minor));
  const base = 10n ** BigInt(d);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(d, "0");
  return `${neg ? "-" : ""}${whole}${d > 0 ? "." + frac : ""}`;
}

/**
 * Integer division of a / b rounded half away from zero.
 * Accepts numbers or bigints, returns a safe integer number.
 */
export function divRound(a: bigint, b: bigint): number {
  if (b === 0n) throw new Error("Division by zero");
  const neg = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  const result = neg ? -q : q;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Amount out of range");
  }
  return Number(result);
}

/** Apply a basis-point rate (1% = 100 bps) to an amount with half-up rounding. */
export function applyBps(amountMinor: number, bps: number): number {
  return divRound(BigInt(amountMinor) * BigInt(bps), 10_000n);
}

export function sumMinor(values: number[]): number {
  const total = values.reduce((acc, v) => acc + BigInt(v), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount out of range");
  return Number(total);
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Convert Bangla digits to ASCII so parsing accepts both. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (ch) => String(BN_DIGITS.indexOf(ch)));
}

export function toBanglaDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** Format minor units for display, e.g. formatMoney(150050, "BDT", "en") -> "৳1,500.50". */
export function formatMoney(minor: number, currency: Currency, locale: "en" | "bn" = "en"): string {
  const d = CURRENCY_DECIMALS[currency];
  const major = Number(minorToDecimalString(minor, currency));
  return new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(major);
}
