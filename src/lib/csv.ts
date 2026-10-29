type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Prevent CSV/formula injection when the file is opened in Excel or Sheets.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}
