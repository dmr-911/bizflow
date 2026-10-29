import { describe, expect, it } from "vitest";
import { calculateDocument, calculateLine, taxBreakdown, type LineInput } from "@/lib/calc";

const line = (p: Partial<LineInput>): LineInput => ({
  quantityMilli: 1000,
  unitPrice: 10000,
  discountType: "percent",
  discountValue: 0,
  taxRateBps: 0,
  ...p,
});

describe("calculateLine", () => {
  it("multiplies quantity and unit price", () => {
    expect(calculateLine(line({ quantityMilli: 3000, unitPrice: 2500 })).total).toBe(7500);
  });

  it("supports fractional quantities with rounding", () => {
    // 1.333 x 10.00 = 13.33
    expect(calculateLine(line({ quantityMilli: 1333, unitPrice: 1000 })).gross).toBe(1333);
    // 0.5 x 0.03 = 0.015 -> 0.02
    expect(calculateLine(line({ quantityMilli: 500, unitPrice: 3 })).gross).toBe(2);
  });

  it("applies percent discount before tax", () => {
    const t = calculateLine(line({ quantityMilli: 2000, unitPrice: 50000, discountValue: 1000, taxRateBps: 1500 }));
    expect(t).toEqual({ gross: 100000, discount: 10000, net: 90000, tax: 13500, total: 103500 });
  });

  it("applies fixed discount and never goes negative", () => {
    expect(calculateLine(line({ discountType: "amount", discountValue: 2500 })).net).toBe(7500);
    const capped = calculateLine(line({ discountType: "amount", discountValue: 999999, taxRateBps: 1500 }));
    expect(capped).toEqual({ gross: 10000, discount: 10000, net: 0, tax: 0, total: 0 });
  });

  it("caps percent discounts at 100%", () => {
    expect(calculateLine(line({ discountValue: 25000 })).total).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => calculateLine(line({ quantityMilli: -1 }))).toThrow();
    expect(() => calculateLine(line({ unitPrice: 1.5 }))).toThrow();
    expect(() => calculateLine(line({ taxRateBps: -100 }))).toThrow();
  });
});

describe("calculateDocument", () => {
  it("totals equal the sum of rounded lines", () => {
    const lines = [
      line({ quantityMilli: 1000, unitPrice: 333, taxRateBps: 1500 }), // 3.33 + 0.50
      line({ quantityMilli: 1000, unitPrice: 333, taxRateBps: 1500 }),
      line({ quantityMilli: 1000, unitPrice: 333, taxRateBps: 1500 }),
    ];
    const t = calculateDocument(lines);
    expect(t.subtotal).toBe(999);
    expect(t.taxTotal).toBe(150);
    expect(t.total).toBe(1149);
    expect(t.lines.reduce((a, l) => a + l.total, 0)).toBe(t.total);
  });

  it("handles mixed tax rates and discounts", () => {
    const t = calculateDocument([
      line({ quantityMilli: 1000, unitPrice: 12000000, taxRateBps: 500 }),
      line({ quantityMilli: 1000, unitPrice: 4500000, taxRateBps: 500 }),
      line({ quantityMilli: 1000, unitPrice: 850000 }),
      line({ quantityMilli: 60000, unitPrice: 12000, discountValue: 1000 }),
    ]);
    expect(t.subtotal).toBe(12000000 + 4500000 + 850000 + 720000);
    expect(t.discountTotal).toBe(72000);
    expect(t.taxTotal).toBe(825000);
    expect(t.total).toBe(t.subtotal - t.discountTotal + t.taxTotal);
  });

  it("is zero for an empty document", () => {
    expect(calculateDocument([])).toMatchObject({ subtotal: 0, total: 0 });
  });
});

describe("taxBreakdown", () => {
  it("groups by tax name and rate", () => {
    const b = taxBreakdown([
      { ...line({ unitPrice: 10000, taxRateBps: 1500 }), taxName: "VAT 15%" },
      { ...line({ unitPrice: 20000, taxRateBps: 1500 }), taxName: "VAT 15%" },
      { ...line({ unitPrice: 10000, taxRateBps: 500 }), taxName: "VAT 5%" },
      { ...line({ unitPrice: 10000 }), taxName: "" },
    ]);
    expect(b).toEqual([
      { name: "VAT 15%", rateBps: 1500, taxable: 30000, tax: 4500 },
      { name: "VAT 5%", rateBps: 500, taxable: 10000, tax: 500 },
    ]);
  });
});
