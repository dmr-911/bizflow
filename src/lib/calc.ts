import { applyBps, divRound, sumMinor } from "./money";

/** Quantities are stored as integer thousandths (1.5 hours = 1500). */
export const QTY_SCALE = 1000;

export type DiscountType = "percent" | "amount";

export interface LineInput {
  /** Quantity in thousandths. */
  quantityMilli: number;
  /** Unit price in minor units. */
  unitPrice: number;
  discountType: DiscountType;
  /** Basis points when percent (10% = 1000), minor units when amount. */
  discountValue: number;
  /** Tax rate in basis points (15% VAT = 1500). */
  taxRateBps: number;
}

export interface LineTotals {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

export interface DocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  lines: LineTotals[];
}

export function calculateLine(line: LineInput): LineTotals {
  if (!Number.isInteger(line.quantityMilli) || line.quantityMilli < 0) throw new Error("Invalid quantity");
  if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) throw new Error("Invalid unit price");
  if (!Number.isInteger(line.taxRateBps) || line.taxRateBps < 0) throw new Error("Invalid tax rate");
  if (!Number.isInteger(line.discountValue) || line.discountValue < 0) throw new Error("Invalid discount");

  const gross = divRound(BigInt(line.quantityMilli) * BigInt(line.unitPrice), BigInt(QTY_SCALE));
  let discount =
    line.discountType === "percent" ? applyBps(gross, Math.min(line.discountValue, 10_000)) : line.discountValue;
  if (discount > gross) discount = gross;
  const net = gross - discount;
  const tax = applyBps(net, line.taxRateBps);
  return { gross, discount, net, tax, total: net + tax };
}

/**
 * Totals are the sum of per-line rounded values, so the printed lines always
 * add up exactly to the printed totals.
 */
export function calculateDocument(lines: LineInput[]): DocumentTotals {
  const computed = lines.map(calculateLine);
  return {
    subtotal: sumMinor(computed.map((l) => l.gross)),
    discountTotal: sumMinor(computed.map((l) => l.discount)),
    taxTotal: sumMinor(computed.map((l) => l.tax)),
    total: sumMinor(computed.map((l) => l.total)),
    lines: computed,
  };
}

/** Group tax by rate for the printed tax summary. */
export function taxBreakdown(
  lines: (LineInput & { taxName: string })[],
): { name: string; rateBps: number; taxable: number; tax: number }[] {
  const map = new Map<string, { name: string; rateBps: number; taxable: number; tax: number }>();
  for (const line of lines) {
    if (line.taxRateBps === 0) continue;
    const t = calculateLine(line);
    const key = `${line.taxName}|${line.taxRateBps}`;
    const cur = map.get(key) ?? { name: line.taxName, rateBps: line.taxRateBps, taxable: 0, tax: 0 };
    cur.taxable += t.net;
    cur.tax += t.tax;
    map.set(key, cur);
  }
  return [...map.values()];
}
