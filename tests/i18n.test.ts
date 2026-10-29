import { describe, expect, it } from "vitest";
import { bn } from "@/lib/i18n/bn";
import { en } from "@/lib/i18n/en";
import { interpolate } from "@/lib/i18n";

function keys(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe("localization", () => {
  it("Bangla has exactly the English keys, all non-empty", () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
    const flat = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "object" ? flat(v) : [v]));
    expect(flat(bn).every((s) => s.trim().length > 0)).toBe(true);
  });

  it("interpolates placeholders", () => {
    expect(interpolate(bn.followUps.reminderBanner, { overdue: "২", today: "১" })).toContain("২টি");
  });
});
