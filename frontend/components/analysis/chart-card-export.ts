import * as XLSX from "xlsx-js-style";

// Excel workbook helpers extracted from dashboard-chart-card.tsx. Pure helpers
// with no dependency beyond xlsx-js-style; behaviour is unchanged.

export type ExcelCellValue = string | number | null;
export type ExcelRow = ExcelCellValue[];

export function toExcelCellValue(value: unknown): ExcelCellValue {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const compact = trimmed.replaceAll(",", "");
    if (/^-?\d+(\.\d+)?$/.test(compact)) {
      const parsed = Number(compact);
      if (Number.isFinite(parsed)) return parsed;
    }
    return trimmed;
  }

  if (value === null || value === undefined) return null;
  return String(value);
}

function normalizeWorksheetName(name: string, fallback: string) {
  const sanitized = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) return fallback;
  return sanitized.slice(0, 31);
}

function applyWorksheetColumnWidths(sheet: XLSX.WorkSheet, rows: ExcelRow[]) {
  if (rows.length === 0) return;
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const maxLength = rows.reduce((currentMax, row) => {
      const value = row[columnIndex];
      const text = value === null || value === undefined ? "" : String(value);
      return Math.max(currentMax, text.length);
    }, 0);
    return { wch: Math.min(Math.max(maxLength + 2, 12), 70) };
  });
  sheet["!cols"] = widths;
}

export function appendWorksheetFromRows(workbook: XLSX.WorkBook, sheetName: string, rows: ExcelRow[], fallbackName: string) {
  if (rows.length === 0) return;
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  applyWorksheetColumnWidths(worksheet, rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, normalizeWorksheetName(sheetName, fallbackName));
}
