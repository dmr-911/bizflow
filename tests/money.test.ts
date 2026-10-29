import { describe, expect, it } from "vitest";
import { applyBps, divRound, formatMoney, minorToDecimalString, parseMoney, parseScaled, sumMinor } from "@/lib/money";

describe("parseMoney", () => {
  it("parses plain and grouped amounts into minor units", () => {
    expect(parseMoney("1250")).toBe(125000);
    expect(parseMoney("1,250.5")).toBe(125050);
    expect(parseMoney("0.01")).toBe(1);
    expect(parseMoney(" ৳ 1,00,000.75 ")).toBe(10000075);
  });

  it("accepts Bangla digits", () => {
    expect(parseMoney("১২০০.৫০")).toBe(120050);
  });

  it("never uses floating point (0.1 + 0.2 problem)", () => {
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(parseMoney("0.3"));
    expect(parseMoney("19.99")).toBe(1999);
    expect(parseMoney("1.005")).toBeNull(); // too many decimals
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "-5", "abc", "1.2.3", "1e5", "12,34x"]) expect(parseMoney(bad)).toBeNull();
    expect(parseMoney("999999999999999")).toBeNull();
  });
});

describe("parseScaled", () => {
  it("scales quantities to thousandths", () => {
    expect(parseScaled("1.5", 3)).toBe(1500);
    expect(parseScaled("7.125", 3)).toBe(7125);
    expect(parseScaled("2", 3)).toBe(2000);
    expect(parseScaled("0.0001", 3)).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3);
    expect(divRound(4n, 2n)).toBe(2);
    expect(divRound(-5n, 2n)).toBe(-3);
    expect(divRound(1n, 3n)).toBe(0);
    expect(divRound(2n, 3n)).toBe(1);
  });

  it("applies basis-point rates", () => {
    expect(applyBps(10000, 1500)).toBe(1500); // 15% of 100.00
    expect(applyBps(333, 1500)).toBe(50); // 49.95 -> 50
    expect(applyBps(1, 5000)).toBe(1); // 0.5 -> 1
    expect(applyBps(12345, 0)).toBe(0);
  });

  it("sums exactly", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
});

describe("formatting", () => {
  it("renders decimal strings", () => {
    expect(minorToDecimalString(123456)).toBe("1234.56");
    expect(minorToDecimalString(5)).toBe("0.05");
    expect(minorToDecimalString(-5)).toBe("-0.05");
  });

  it("formats BDT and USD", () => {
    expect(formatMoney(150050, "USD")).toBe("$1,500.50");
    expect(formatMoney(150050, "BDT")).toContain("1,500.50");
    expect(formatMoney(150050, "BDT")).toContain("৳");
    expect(formatMoney(150050, "BDT", "bn")).toContain("৳");
    expect(formatMoney(150050, "BDT", "bn")).toMatch(/[০-৯]/);
  });
});
