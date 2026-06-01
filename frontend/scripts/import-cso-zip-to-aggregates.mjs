import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import XLSX from "xlsx-js-style";

const ZIP_PATH = process.env.CSO_ZIP_PATH || "C:/Users/dekok/Downloads/CSOs Reports (2).zip";
const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const DEFAULT_PROJECT_ID = Number(process.env.DEFAULT_PROJECT_ID || "") || null;
const DEFAULT_PERIOD_START = process.env.DEFAULT_PERIOD_START || "";
const DEFAULT_PERIOD_END = process.env.DEFAULT_PERIOD_END || "";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const authHeaders = (json = true) => {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
};

const apiGetJson = async (url) => {
  const response = await fetch(url, { headers: authHeaders(false) });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
};

const apiPostJson = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
};

const listExistingIndicatorIds = async ({ project, organization, period_start, period_end }) => {
  const ids = new Set();
  const params = new URLSearchParams({
    project: String(project),
    organization: String(organization),
    period_start: String(period_start),
    period_end: String(period_end),
    page_size: "500",
  });

  let nextUrl = `${API_BASE}/aggregates/?${params.toString()}`;
  while (nextUrl) {
    const data = await apiGetJson(nextUrl);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const row of results) {
      const indicatorId = Number(row?.indicator);
      if (!Number.isNaN(indicatorId)) ids.add(indicatorId);
    }
    nextUrl = data?.next || null;
  }

  return ids;
};

const listAll = async (endpoint) => {
  const items = [];
  let nextUrl = `${API_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}page_size=500`;
  while (nextUrl) {
    const data = await apiGetJson(nextUrl);
    const results = Array.isArray(data?.results) ? data.results : [];
    items.push(...results);
    nextUrl = data?.next || null;
  }
  return items;
};

const normalizeDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ddmmyyyy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
        .toString()
        .padStart(2, "0")}`;
    }
  }

  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && numeric > 20000 && numeric < 80000) {
    const utcMillis = Math.round((numeric - 25569) * 86400 * 1000);
    const excelDate = new Date(utcMillis);
    if (!Number.isNaN(excelDate.getTime())) return excelDate.toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
};

const parseNumber = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const shouldImportEntry = (entryName) => {
  const ext = path.extname(entryName).toLowerCase();
  return [".xlsx", ".xls", ".xlsm"].includes(ext);
};

const collectEntries = async (zipBuffer, prefix = "") => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files = [];

  for (const entry of Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.dir) continue;
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const ext = path.extname(entry.name).toLowerCase();

    if (ext === ".zip") {
      const nestedBuffer = Buffer.from(await entry.async("uint8array"));
      const nestedFiles = await collectEntries(nestedBuffer, fullPath);
      files.push(...nestedFiles);
      continue;
    }

    if (!shouldImportEntry(entry.name)) continue;
    const content = Buffer.from(await entry.async("uint8array"));
    files.push({ fullPath, fileName: path.basename(entry.name), content });
  }

  return files;
};

const inferOrganizationId = (entryPath, organizations) => {
  const parts = entryPath.split("/").map(normalize).filter(Boolean).reverse();

  for (const part of parts) {
    const exact = organizations.find((org) => normalize(org.name) === part);
    if (exact) return Number(exact.id);
  }

  for (const part of parts) {
    const fuzzy = organizations.find((org) => {
      const orgName = normalize(org.name);
      return part.includes(orgName) || (part.length >= 5 && orgName.includes(part));
    });
    if (fuzzy) return Number(fuzzy.id);
  }

  return null;
};

const detectHeader = (rows) => {
  let bestIndex = -1;
  let bestScore = -1;

  const scanLimit = Math.min(rows.length, 30);
  for (let i = 0; i < scanLimit; i += 1) {
    const header = (rows[i] || []).map((c) => normalizeHeader(c));
    if (!header.some(Boolean)) continue;

    const hasIndicator = header.includes("indicator_id") || header.includes("indicator_name") || header.includes("indicator");
    const hasProject = header.includes("project_id") || header.includes("project_name") || header.includes("project");
    const hasOrganization = header.includes("organization_id") || header.includes("organization_name") || header.includes("organization");
    const hasPeriod = header.includes("period_start") || header.includes("period_end") || header.includes("start") || header.includes("end");

    let score = 0;
    if (hasIndicator) score += 2;
    if (hasProject) score += 1;
    if (hasOrganization) score += 1;
    if (hasPeriod) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < 2) return null;
  return {
    header: (rows[bestIndex] || []).map((c) => normalizeHeader(c)),
    dataRows: rows.slice(bestIndex + 1),
  };
};

const getByAliases = (row, header, aliases) => {
  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx >= 0) {
      const value = row[idx];
      const text = String(value ?? "").trim();
      if (text) return text;
    }
  }
  return "";
};

const main = async () => {
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error(`ZIP not found: ${ZIP_PATH}`);
  }

  console.log("Loading organizations/projects/indicators...");
  const [organizations, projects, indicators] = await Promise.all([
    listAll("/organizations/"),
    listAll("/manage/projects/"),
    listAll("/indicators/"),
  ]);

  const indicatorIdByName = new Map(indicators.map((i) => [normalize(i.name), Number(i.id)]));
  const indicatorIdByCode = new Map(indicators.map((i) => [normalize(i.code), Number(i.id)]));
  const projectIdByName = new Map(projects.map((p) => [normalize(p.name), Number(p.id)]));
  const orgIdByName = new Map(organizations.map((o) => [normalize(o.name), Number(o.id)]));
  const inferredDefaultProjectId =
    DEFAULT_PROJECT_ID ||
    projects.find((project) => normalize(project.name).includes("nahpa"))?.id ||
    projects[0]?.id ||
    null;
  const fallbackPeriodStart = normalizeDate(DEFAULT_PERIOD_START);
  const fallbackPeriodEnd = normalizeDate(DEFAULT_PERIOD_END);

  console.log("Reading ZIP...");
  const entries = await collectEntries(fs.readFileSync(ZIP_PATH));
  console.log(`Spreadsheet entries found: ${entries.length}`);

  let payloadRows = 0;
  let skippedRows = 0;
  const skipReasons = {
    indicator: 0,
    project: 0,
    organization: 0,
    period: 0,
  };
  let headerLogs = 0;
  const grouped = new Map();

  for (const entry of entries) {
    const fallbackOrgId = inferOrganizationId(entry.fullPath, organizations);

    try {
      const workbook = XLSX.read(entry.content, { type: "buffer" });
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).map((r) =>
          r.map((c) => (c === undefined || c === null ? "" : String(c)))
        );

        const ctx = detectHeader(rows);
        if (!ctx) continue;
        const { header, dataRows } = ctx;
        if (headerLogs < 8) {
          headerLogs += 1;
          console.log(`HDR | ${entry.fullPath} :: ${sheetName} -> ${header.join(",")}`);
        }

        for (const row of dataRows) {
          if (!row.some((c) => String(c || "").trim())) continue;

          const indicatorRaw = getByAliases(row, header, ["indicator_id", "indicator_name", "indicator", "indicator_code", "code"]);
          const projectRaw = getByAliases(row, header, ["project_id", "project_name", "project"]);
          const orgRaw = getByAliases(row, header, ["organization_id", "organization_name", "organization", "organisation"]);
          const periodStartRaw = getByAliases(row, header, ["period_start", "start_date", "start", "period_from", "from"]);
          const periodEndRaw = getByAliases(row, header, ["period_end", "end_date", "end", "period_to", "to"]);

          const indicatorNumeric = Number(indicatorRaw);
          const indicatorId =
            (!Number.isNaN(indicatorNumeric) && indicatorNumeric > 0 ? indicatorNumeric : null) ||
            indicatorIdByName.get(normalize(indicatorRaw)) ||
            indicatorIdByCode.get(normalize(indicatorRaw)) ||
            null;

          const projectNumeric = Number(projectRaw);
          const projectId =
            (!Number.isNaN(projectNumeric) && projectNumeric > 0 ? projectNumeric : null) ||
            projectIdByName.get(normalize(projectRaw)) ||
            (inferredDefaultProjectId ? Number(inferredDefaultProjectId) : null) ||
            null;

          const orgNumeric = Number(orgRaw);
          const organizationId =
            (!Number.isNaN(orgNumeric) && orgNumeric > 0 ? orgNumeric : null) ||
            orgIdByName.get(normalize(orgRaw)) ||
            fallbackOrgId ||
            null;

          const periodStart = normalizeDate(periodStartRaw) || fallbackPeriodStart;
          const periodEnd = normalizeDate(periodEndRaw) || fallbackPeriodEnd;

          if (!indicatorId || !projectId || !organizationId || !periodStart || !periodEnd) {
            if (!indicatorId) skipReasons.indicator += 1;
            if (!projectId) skipReasons.project += 1;
            if (!organizationId) skipReasons.organization += 1;
            if (!periodStart || !periodEnd) skipReasons.period += 1;
            skippedRows += 1;
            continue;
          }

          let value = {};
          const valueJson = getByAliases(row, header, ["value_json", "json", "value"]);
          if (valueJson && (valueJson.startsWith("{") || valueJson.startsWith("["))) {
            try {
              value = JSON.parse(valueJson);
            } catch {
              value = {};
            }
          }

          const male = parseNumber(getByAliases(row, header, ["male", "m"]));
          const female = parseNumber(getByAliases(row, header, ["female", "f"]));
          const total = parseNumber(getByAliases(row, header, ["total", "totals", "count", "amount"]));

          if (typeof value !== "object" || value === null || Object.keys(value).length === 0) {
            value = {
              ...(male !== undefined ? { male } : {}),
              ...(female !== undefined ? { female } : {}),
              ...(total !== undefined ? { total } : {}),
            };
            if (Object.keys(value).length === 0) value = { total: 0 };
          }

          const notes = getByAliases(row, header, ["notes", "note", "comment", "comments"]);

          const key = `${projectId}::${organizationId}::${periodStart}::${periodEnd}`;
          if (!grouped.has(key)) {
            grouped.set(key, {
              project: projectId,
              organization: organizationId,
              period_start: periodStart,
              period_end: periodEnd,
              data: [],
            });
          }

          grouped.get(key).data.push({
            indicator: indicatorId,
            value,
            notes: notes || "",
          });
          payloadRows += 1;
        }
      }
    } catch (error) {
      console.error(`Failed to parse ${entry.fullPath}: ${String(error?.message || error)}`);
    }
  }

  console.log(`Prepared rows: ${payloadRows}, skipped: ${skippedRows}, groups: ${grouped.size}`);
  console.log(`Skip reasons: ${JSON.stringify(skipReasons)}`);

  for (const group of grouped.values()) {
    const byIndicator = new Map();
    for (const item of group.data) {
      const key = Number(item.indicator);
      if (!Number.isNaN(key)) {
        byIndicator.set(key, item);
      }
    }
    group.data = Array.from(byIndicator.values());
  }

  let createdTotal = 0;
  let failedGroups = 0;
  for (const [key, group] of grouped.entries()) {
    try {
      const existingIndicatorIds = await listExistingIndicatorIds(group);
      const filteredData = group.data.filter((item) => !existingIndicatorIds.has(Number(item.indicator)));
      if (filteredData.length === 0) {
        console.log(`SKIP| ${key} -> all indicators already exist`);
        continue;
      }

      const result = await apiPostJson(`${API_BASE}/aggregates/bulk_create/`, group);
      const created = Number(result?.created || 0);
      createdTotal += created;
      console.log(`OK  | ${key} -> created=${created}`);
    } catch (error) {
      failedGroups += 1;
      console.error(`ERR | ${key} -> ${String(error?.message || error)}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Groups processed: ${grouped.size}`);
  console.log(`Rows prepared: ${payloadRows}`);
  console.log(`Rows created: ${createdTotal}`);
  console.log(`Rows skipped: ${skippedRows}`);
  console.log(`Failed groups: ${failedGroups}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
