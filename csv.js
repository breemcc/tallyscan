// RFC 4180 style CSV: every cell quoted, quotes doubled, CRLF line breaks.
// Cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
const cell = (value) => {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
};

export function sheetToCsv(sheet, rows) {
  const header = ["Barcode", ...sheet.fields.map((f) => f.name), "Created", "Updated"];
  const lines = [header, ...rows.map((r) => [
    r.barcode,
    ...sheet.fields.map((f) => {
      const v = r.values[f.id];
      return f.type === "checkbox" ? (v ? "Yes" : "No") : v;
    }),
    new Date(r.createdAt).toISOString(),
    new Date(r.updatedAt).toISOString(),
  ])];
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
