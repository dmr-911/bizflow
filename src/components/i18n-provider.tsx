"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeFormatter, type FormatPrefs, type Formatter } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";

const Ctx = createContext<{ t: Dictionary; fmt: Formatter; prefs: FormatPrefs } | null>(null);

export function I18nProvider({ dict, prefs, children }: { dict: Dictionary; prefs: FormatPrefs; children: ReactNode }) {
  const value = useMemo(() => ({ t: dict, fmt: makeFormatter(prefs), prefs }), [dict, prefs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}
