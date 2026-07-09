import "server-only";
import Papa from "papaparse";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
};

const MAX_ROWS = 10000;

/**
 * Parses a CSV or XLSX import file into headers + string rows. The first
 * non-empty row is treated as the header. Row count is capped to keep
 * serverless memory/time bounded.
 */
export async function parseImportFile(bytes: Uint8Array, fileName: string): Promise<ParsedTable> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsx(bytes);
  }
  return parseCsv(bytes);
}

function parseCsv(bytes: Uint8Array): ParsedTable {
  const text = decodeText(bytes);
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const data = (result.data as string[][]).slice(0, MAX_ROWS + 1);
  if (data.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = data;
  return {
    headers: headers.map((h) => (h ?? "").toString()),
    rows: rows.map((r) => r.map((c) => (c ?? "").toString())),
  };
}

async function parseXlsx(bytes: Uint8Array): Promise<ParsedTable> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (table.length > MAX_ROWS) return;
    const cells: string[] = [];
    // row.values is 1-based; normalize to a dense 0-based string array.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i++) {
      cells.push(cellToString(values[i]));
    }
    table.push(cells);
  });

  if (table.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = table;
  return { headers, rows };
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    // ExcelJS rich values: { text }, { result }, { richText: [...] }, Date
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(value);
}

function decodeText(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM if present; fall back to latin1 when UTF-8 fails hard.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}
