/**
 * CSV building for exports (German Excel dialect: semicolon separator).
 * Every cell is quoted and guarded against formula injection (CWE-1236):
 * cells starting with = + - @ get a leading apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '""';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function buildCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  // BOM so Excel opens UTF-8 umlauts correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}
