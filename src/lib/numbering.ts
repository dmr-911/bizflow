export interface NumberingConfig {
  prefix: string;
  /** Minimum digits for the sequence part, zero padded. */
  padding: number;
  /** Next sequence value to hand out. */
  next: number;
  /** Include the issue year, e.g. INV-2026-0001. */
  includeYear: boolean;
}

export function formatDocumentNumber(cfg: NumberingConfig, seq: number, year: number): string {
  const seqPart = String(seq).padStart(Math.max(1, Math.min(cfg.padding, 10)), "0");
  return `${cfg.prefix}${cfg.includeYear ? `${year}-` : ""}${seqPart}`;
}

/**
 * Hand out the next free number. `isTaken` is checked so that a lowered
 * "next number" setting or an imported document can never produce a duplicate;
 * the database UNIQUE constraint is the final guard.
 */
export function allocateDocumentNumber(
  cfg: NumberingConfig,
  year: number,
  isTaken: (candidate: string) => boolean,
): { number: string; next: number } {
  let seq = Math.max(1, Math.floor(cfg.next));
  for (let attempts = 0; attempts < 100_000; attempts++, seq++) {
    const candidate = formatDocumentNumber(cfg, seq, year);
    if (!isTaken(candidate)) return { number: candidate, next: seq + 1 };
  }
  throw new Error("Could not allocate a document number");
}
