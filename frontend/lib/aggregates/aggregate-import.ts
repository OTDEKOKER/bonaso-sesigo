import * as XLSX from "xlsx-js-style";
import type { AggregateValue } from "@/lib/aggregates/aggregate-helpers";
import { isValidIsoDate, parseNumberInput } from "@/lib/aggregates/aggregate-helpers";
import type { AggregateTemplate } from "@/lib/api/services/aggregates";

export type AggregateImportPayload = {
  indicator: number;
  project: number;
  organization: number;
  period_start: string;
  period_end: string;
  value: AggregateValue | unknown;
  notes?: string;
};

export type GroupedAggregateImportPayload = {
  project: number;
  organization: number;
  period_start: string;
  period_end: string;
  data: Array<{
    indicator: number;
    value: AggregateValue | unknown;
    notes?: string;
  }>;
};

export type ImportTemplateLike = Pick<AggregateTemplate, "name"> & {
  indicators: Array<{ id: number; name?: string }>;
};

export type ImportEntityOption = {
  id: string | number;
  name?: string;
};

export type BuildImportPayloadsArgs = {
  file: File;
  organizations: ImportEntityOption[];
  projects: ImportEntityOption[];
  indicators: ImportEntityOption[];
  templates: ImportTemplateLike[];
  canReportAcrossOrganizations: boolean;
  writableOrganizationIds: Set<string>;
};

export type BuildImportPayloadsResult = {
  payloads: AggregateImportPayload[];
  failedCount: number;
  errors: string[];
};

export const AGGREGATE_IMPORT_REQUIRED_COLUMNS_HINT =
  "indicator_id or indicator_name, project_id or project_name, organization_id or organization_name, period_start, period_end, and at least one of value_json, male, female, or total";

const MAX_IMPORT_ERRORS = 8;
const VALUE_COLUMNS = ["value_json", "male", "female", "total"] as const;
const NON_AGGREGATE_IMPORT_SHEET_NAMES = new Set([
  "indicator matrix",
  "indicator matrix sheet",
  "matrix",
  "drop down",
  "dropdown",
  "instructions",
  "instruction",
  "summary",
  "total",
  "totals",
  "cover",
  "contents",
  "readme",
  "notes",
]);
const IDENTIFIER_COLUMN_GROUPS = [
  {
    label: "indicator",
    columns: ["indicator_id", "indicator_name"] as const,
  },
  {
    label: "project",
    columns: ["project_id", "project_name"] as const,
  },
  {
    label: "organization",
    columns: ["organization_id", "organization_name"] as const,
  },
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSheetName(value: string): string {
  return normalize(value.replace(/[_-]+/g, " ").replace(/\s+/g, " "));
}

function isNonAggregateImportSheet(sheetName: string): boolean {
  return NON_AGGREGATE_IMPORT_SHEET_NAMES.has(normalizeSheetName(sheetName));
}

function getNormalizedHeader(rows: string[][]): string[] {
  return (rows[0] || []).map((value) => value.trim().toLowerCase());
}

function hasFlatAggregateHeader(rows: string[][]): boolean {
  const header = getNormalizedHeader(rows);
  if (header.length === 0) return false;

  const hasIdentifierGroups = IDENTIFIER_COLUMN_GROUPS.every((group) =>
    group.columns.some((column) => header.includes(column)),
  );
  const hasPeriodColumns = header.includes("period_start") && header.includes("period_end");
  const hasValueColumn = VALUE_COLUMNS.some((column) => header.includes(column));
  return hasIdentifierGroups && hasPeriodColumns && hasValueColumn;
}

function looksLikeReportWorkbookSheet(rows: string[][]): boolean {
  return rows.some((row) => {
    const codeTitlePairs = [
      [row[0], row[1]],
      [row[1], row[2]],
    ];
    return codeTitlePairs.some(([rawCode, rawTitle]) => {
      const code = String(rawCode || "").trim();
      const title = String(rawTitle || "").trim().toLowerCase();
      return /^\d+[a-z]?$/i.test(code) && title.startsWith("number");
    });
  });
}

function resolveId(value: string, list: ImportEntityOption[]): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const numericExists = list.some((item) => Number(item.id) === numeric);
    return numericExists ? numeric : null;
  }
  const match = list.find((item) => normalize(item.name || "") === normalize(value));
  return match ? Number(match.id) : null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  const row: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current !== "" || row.length > 0) {
        row.push(current);
        rows.push([...row]);
        row.length = 0;
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function parseRowsToPayloads(args: {
  rows: string[][];
  sourceLabel: string;
  templateIndicators: Array<{ id: number; name?: string }>;
  organizations: ImportEntityOption[];
  projects: ImportEntityOption[];
  indicators: ImportEntityOption[];
  canReportAcrossOrganizations: boolean;
  writableOrganizationIds: Set<string>;
}): BuildImportPayloadsResult {
  const {
    rows,
    sourceLabel,
    templateIndicators,
    organizations,
    projects,
    indicators,
    canReportAcrossOrganizations,
    writableOrganizationIds,
  } = args;

  if (rows.length < 2) {
    return { payloads: [], failedCount: 0, errors: [] };
  }

  const header = getNormalizedHeader(rows);
  const getColumn = (row: string[], key: string) => {
    const index = header.indexOf(key);
    return index >= 0 ? row[index]?.trim() ?? "" : "";
  };
  const hasHeaderColumn = (key: string) => header.includes(key);
  const addError = (errors: string[], message: string) => {
    if (errors.length < MAX_IMPORT_ERRORS) {
      errors.push(message);
    }
  };
  const normalizeDateValue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isValidIsoDate(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
    const day = `${parsed.getDate()}`.padStart(2, "0");
    const normalized = `${year}-${month}-${day}`;
    return isValidIsoDate(normalized) ? normalized : null;
  };
  const isBlankRow = (row: string[]) => row.every((value) => value.trim() === "");
  const hasAnyValueColumn = VALUE_COLUMNS.some((column) => hasHeaderColumn(column));
  const headerErrors: string[] = [];

  IDENTIFIER_COLUMN_GROUPS.forEach((group) => {
    if (!group.columns.some((column) => hasHeaderColumn(column))) {
      addError(
        headerErrors,
        `${sourceLabel}: missing ${group.columns.join(" or ")} column.`,
      );
    }
  });
  if (!hasHeaderColumn("period_start")) {
    addError(headerErrors, `${sourceLabel}: missing period_start column.`);
  }
  if (!hasHeaderColumn("period_end")) {
    addError(headerErrors, `${sourceLabel}: missing period_end column.`);
  }
  if (!hasAnyValueColumn) {
    addError(
      headerErrors,
      `${sourceLabel}: missing one value column (${VALUE_COLUMNS.join(", ")}).`,
    );
  }

  if (headerErrors.length > 0) {
    return {
      payloads: [],
      failedCount: Math.max(rows.length - 1, 0),
      errors: headerErrors,
    };
  }

  const payloads: AggregateImportPayload[] = [];
  let failedCount = 0;
  const errors: string[] = [];
  const seenRows = new Set<string>();

  for (const [offset, row] of rows.slice(1).entries()) {
    if (isBlankRow(row)) {
      continue;
    }

    const rowNumber = offset + 2;
    const rowLabel = `${sourceLabel} row ${rowNumber}`;

    try {
      const indicatorValue = getColumn(row, "indicator_id") || getColumn(row, "indicator_name");
      if (!indicatorValue) {
        failedCount += 1;
        addError(errors, `${rowLabel}: indicator_id or indicator_name is required.`);
        continue;
      }

      let indicatorId = resolveId(indicatorValue, indicators);
      if (!indicatorId && templateIndicators.length > 0) {
        indicatorId = resolveId(indicatorValue, templateIndicators);
      }
      if (!indicatorId) {
        failedCount += 1;
        addError(errors, `${rowLabel}: indicator "${indicatorValue}" was not found.`);
        continue;
      }

      const projectValue = getColumn(row, "project_id") || getColumn(row, "project_name");
      if (!projectValue) {
        failedCount += 1;
        addError(errors, `${rowLabel}: project_id or project_name is required.`);
        continue;
      }

      const projectId = resolveId(
        projectValue,
        projects,
      );
      if (!projectId) {
        failedCount += 1;
        addError(errors, `${rowLabel}: project "${projectValue}" was not found.`);
        continue;
      }

      const organizationValue =
        getColumn(row, "organization_id") || getColumn(row, "organization_name");
      if (!organizationValue) {
        failedCount += 1;
        addError(errors, `${rowLabel}: organization_id or organization_name is required.`);
        continue;
      }

      const organizationId = resolveId(
        organizationValue,
        organizations,
      );
      if (!organizationId) {
        failedCount += 1;
        addError(errors, `${rowLabel}: organization "${organizationValue}" was not found.`);
        continue;
      }

      const periodStart = normalizeDateValue(getColumn(row, "period_start"));
      const periodEnd = normalizeDateValue(getColumn(row, "period_end"));

      if (!periodStart) {
        failedCount += 1;
        addError(errors, `${rowLabel}: period_start must be a valid date.`);
        continue;
      }
      if (!periodEnd) {
        failedCount += 1;
        addError(errors, `${rowLabel}: period_end must be a valid date.`);
        continue;
      }
      if (periodEnd < periodStart) {
        failedCount += 1;
        addError(errors, `${rowLabel}: period_end cannot be earlier than period_start.`);
        continue;
      }

      const rowKey = `${indicatorId}::${projectId}::${organizationId}::${periodStart}::${periodEnd}`;
      if (seenRows.has(rowKey)) {
        failedCount += 1;
        addError(
          errors,
          `${rowLabel}: duplicate aggregate row for the same indicator, project, organization, and period.`,
        );
        continue;
      }

      if (
        !canReportAcrossOrganizations &&
        !writableOrganizationIds.has(String(organizationId))
      ) {
        failedCount += 1;
        addError(errors, `${rowLabel}: you cannot import data for organization "${organizationValue}".`);
        continue;
      }

      let value: AggregateValue | unknown = {};
      const valueJson = getColumn(row, "value_json");
      if (valueJson) {
        try {
          value = JSON.parse(valueJson);
        } catch {
          failedCount += 1;
          addError(errors, `${rowLabel}: value_json must contain valid JSON.`);
          continue;
        }
      }

      const male = parseNumberInput(getColumn(row, "male"));
      const female = parseNumberInput(getColumn(row, "female"));
      const total = parseNumberInput(getColumn(row, "total"));
      const hasValueInput = VALUE_COLUMNS.some((column) => getColumn(row, column) !== "");

      if (!hasValueInput) {
        failedCount += 1;
        addError(
          errors,
          `${rowLabel}: at least one of value_json, male, female, or total is required.`,
        );
        continue;
      }

      if (typeof value === "object" && value !== null) {
        if (male !== undefined) (value as AggregateValue).male = male;
        if (female !== undefined) (value as AggregateValue).female = female;
        if (total !== undefined) (value as AggregateValue).total = total;
      }

      if (
        !value ||
        (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)
      ) {
        const fallbackValue: AggregateValue = {
          ...(male !== undefined ? { male } : {}),
          ...(female !== undefined ? { female } : {}),
          ...(total !== undefined ? { total } : {}),
        };
        if (
          fallbackValue.total === undefined &&
          (fallbackValue.male !== undefined || fallbackValue.female !== undefined)
        ) {
          fallbackValue.total = (fallbackValue.male ?? 0) + (fallbackValue.female ?? 0);
        }
        value = fallbackValue;
      }

      if (
        !value ||
        (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)
      ) {
        failedCount += 1;
        addError(
          errors,
          `${rowLabel}: aggregate value could not be derived from value_json, male, female, or total.`,
        );
        continue;
      }

      payloads.push({
        indicator: indicatorId,
        project: projectId,
        organization: organizationId,
        period_start: periodStart,
        period_end: periodEnd,
        value,
        notes: getColumn(row, "notes") || undefined,
      });
      seenRows.add(rowKey);
    } catch {
      failedCount += 1;
      addError(errors, `${rowLabel}: the row could not be parsed.`);
    }
  }

  return { payloads, failedCount, errors };
}

export async function buildImportPayloadsFromFile(
  args: BuildImportPayloadsArgs,
): Promise<BuildImportPayloadsResult> {
  const {
    file,
    organizations,
    projects,
    indicators,
    templates,
    canReportAcrossOrganizations,
    writableOrganizationIds,
  } = args;

  const extension = file.name.split(".").pop()?.toLowerCase();
  const findTemplateBySheet = (sheetName: string) =>
    templates.find((template) => normalize(template.name || "") === normalize(sheetName)) ?? null;

  let payloads: AggregateImportPayload[] = [];
  let failedCount = 0;
  let errors: string[] = [];

  if (extension === "xlsx" || extension === "xls") {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const sheetNames = workbook.SheetNames.length ? workbook.SheetNames : [];
    let flatSheetCount = 0;
    let skippedReportSheetCount = 0;

    for (const sheetName of sheetNames) {
      if (isNonAggregateImportSheet(sheetName)) {
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = (
        XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          dateNF: "yyyy-mm-dd",
        }) as Array<Array<unknown>>
      ).map((row) =>
        row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))),
      );

      if (!hasFlatAggregateHeader(rows)) {
        if (looksLikeReportWorkbookSheet(rows)) {
          skippedReportSheetCount += 1;
          continue;
        }
      }

      const template = findTemplateBySheet(sheetName);
      const templateIndicators = template?.indicators || [];

      const parsed = parseRowsToPayloads({
        rows,
        sourceLabel: `Sheet "${sheetName}"`,
        templateIndicators,
        organizations,
        projects,
        indicators,
        canReportAcrossOrganizations,
        writableOrganizationIds,
      });

      if (parsed.errors.length === 0 || parsed.payloads.length > 0) {
        flatSheetCount += 1;
      }
      payloads = payloads.concat(parsed.payloads);
      failedCount += parsed.failedCount;
      errors = errors.concat(parsed.errors).slice(0, MAX_IMPORT_ERRORS);
    }

    if (payloads.length === 0 && errors.length === 0 && skippedReportSheetCount > 0) {
      return {
        payloads: [],
        failedCount: 0,
        errors: [
          "This looks like a report-workbook file, not the flat aggregate import template. Use Report Workbooks import for report-style files, or Export from Aggregates for the flat aggregate template.",
        ],
      };
    }

    if (payloads.length === 0 && errors.length === 0 && flatSheetCount === 0) {
      return {
        payloads: [],
        failedCount: 0,
        errors: [
          "No flat aggregate import sheets were found. Use an aggregate export file with flat columns, or import report-style workbooks from Report Workbooks.",
        ],
      };
    }

    return { payloads, failedCount, errors };
  }

  const text = await file.text();
  const rows = parseCsv(text);
  return parseRowsToPayloads({
    rows,
    sourceLabel: `File "${file.name}"`,
    templateIndicators: [],
    organizations,
    projects,
    indicators,
    canReportAcrossOrganizations,
    writableOrganizationIds,
  });
}

export function groupImportPayloadsByScope(
  payloads: AggregateImportPayload[],
): GroupedAggregateImportPayload[] {
  const grouped = new Map<string, GroupedAggregateImportPayload>();

  for (const payload of payloads) {
    const key = `${payload.project}::${payload.organization}::${payload.period_start}::${payload.period_end}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.data.push({
        indicator: payload.indicator,
        value: payload.value,
        notes: payload.notes,
      });
      continue;
    }

    grouped.set(key, {
      project: payload.project,
      organization: payload.organization,
      period_start: payload.period_start,
      period_end: payload.period_end,
      data: [
        {
          indicator: payload.indicator,
          value: payload.value,
          notes: payload.notes,
        },
      ],
    });
  }

  return Array.from(grouped.values());
}
