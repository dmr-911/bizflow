import { describe, expect, it } from "vitest";
import { allocateDocumentNumber, formatDocumentNumber } from "@/lib/numbering";
import { formatDate } from "@/lib/dates";

describe("document numbering", () => {
  const cfg = { prefix: "INV-", padding: 4, next: 7, includeYear: true };

  it("formats with prefix, year and padding", () => {
    expect(formatDocumentNumber(cfg, 7, 2026)).toBe("INV-2026-0007");
    expect(formatDocumentNumber({ ...cfg, includeYear: false, padding: 2 }, 123, 2026)).toBe("INV-123");
  });

  it("skips numbers already in use", () => {
    const taken = new Set(["INV-2026-0007", "INV-2026-0008"]);
    expect(allocateDocumentNumber(cfg, 2026, (n) => taken.has(n))).toEqual({ number: "INV-2026-0009", next: 10 });
  });
});

describe("date formatting", () => {
  it("supports configurable formats", () => {
    expect(formatDate("2026-03-05", "DD/MM/YYYY")).toBe("05/03/2026");
    expect(formatDate("2026-03-05", "MM/DD/YYYY")).toBe("03/05/2026");
    expect(formatDate("2026-03-05", "YYYY-MM-DD")).toBe("2026-03-05");
    expect(formatDate("2026-03-05", "DD MMM YYYY")).toBe("05 Mar 2026");
    expect(formatDate("2026-03-05", "DD/MM/YYYY", "bn")).toBe("০৫/০৩/২০২৬");
  });
});
