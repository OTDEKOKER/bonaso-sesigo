"use client";

import { formatDate } from "../../lib/date-utils";

export type BreakdownOption = {
  value: unknown;
  label?: string;
};

export type BreakdownMap = Record<string, BreakdownOption[]>;

export function cleanLabel(value: string | null | undefined) {
  if (!value) return "—";

  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBreakdownLabel(
  breakdowns: BreakdownMap | undefined,
  field: string | null | undefined,
  value: unknown,
) {
  if (!field || value === null || value === undefined) return null;

  const options = breakdowns?.[field];
  if (!Array.isArray(options)) return null;

  const match = options.find(
    (option) => String(option?.value ?? "") === String(value),
  );

  return match?.label ?? null;
}

export function formatAnalyticsValue(
  value: unknown,
  options?: {
    field?: string | null;
    breakdowns?: BreakdownMap;
    dateFields?: string[];
  },
) {
  const field = options?.field ?? null;
  const dateFields = (options?.dateFields ?? [
    "dob",
    "response_date",
    "start",
    "end",
    "date",
  ]).map((entry) => entry.toLowerCase());

  if (value === null || value === undefined || value === "") return "—";

  if (Array.isArray(value)) {
    if (value.length === 0) return "—";

    const joined = value
      .map((item) => formatAnalyticsValue(item, options))
      .filter((item) => item !== "—")
      .join(", ");

    return joined || "—";
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";

  const mapped = normalizeBreakdownLabel(options?.breakdowns, field, value);
  if (mapped) return mapped;

  const normalizedField = field?.toLowerCase() ?? "";
  const isDateField =
    dateFields.includes(normalizedField) ||
    normalizedField.endsWith("_date") ||
    normalizedField.endsWith("_at");

  if (isDateField) {
    return formatDate(typeof value === "string" ? value : String(value));
  }

  if (typeof value === "string") return cleanLabel(value);

  return String(value);
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
