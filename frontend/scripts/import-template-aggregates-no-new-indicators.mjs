import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx-js-style";

const SOURCE_PATH = process.env.AGGREGATE_SOURCE_PATH || "C:/Users/dekok/Downloads/Copy of TEBELOPELE- NAHPA REPORTING TEMPLATE 2025_26 QUARTER 3.xlsm";
const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const DEFAULT_PROJECT_ID = Number(process.env.DEFAULT_PROJECT_ID || "") || null;
const DEFAULT_ORGANIZATION_ID = Number(process.env.DEFAULT_ORGANIZATION_ID || "") || null;
const DEFAULT_PERIOD_START = process.env.DEFAULT_PERIOD_START || "2026-01-01";
const DEFAULT_PERIOD_END = process.env.DEFAULT_PERIOD_END || "2026-03-31";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

if (!fs.existsSync(SOURCE_PATH)) {
  console.error(`Source file not found: ${SOURCE_PATH}`);
  process.exit(1);
}

const ORG_ALIASES = {
  tebelopele: "TEBELOPELE",
  sentebale: "Sentebale",
  bofwa: "BOFWA",
  "stepping stone international": "Stepping Stone International",
  "bobonong home based care": "Bobonong Home Based Care",
  "mabogo aa thebana association s": "Mabogo aa Thebana Association South",
  ovajua: "Ovajua",
  "gumare advisory": "Gumare Advisory",
  "positive moments": "Positive Moments",
  "mind power": "Mind Power",
  "mopipi international trust": "Mopipi International Trust",
  "house of angels": "House of Angels",
  "inspired hozirons": "Inspired Horizons",
  "hope worldwide": "Hope Worldwide",
  "rena le seabe": "Rena le Seabe",
  "social dialogue": "Social Dialogue",
  inerela: "INERELA",
};

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const canonicalIndicatorKey = (value) =>
  normalize(value)
    .replace(/\bnunber\b/g, "number")
    .replace(/\bno\.?\b/g, "number")
    .replace(/\s+/g, " ")
    .trim();

const authHeaders = (json = true) => {
  const headers = { Authorization: `Bearer ${TOKEN}` };
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
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const listAll = async (endpoint) => {
  const items = [];
  let nextUrl = `${API_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}page_size=500`;
  while (nextUrl) {
    const data = await apiGetJson(nextUrl);
    items.push(...(Array.isArray(data?.results) ? data.results : []));
    nextUrl = data?.next || null;
  }
  return items;
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
    for (const row of data?.results || []) {
      const indicatorId = Number(row?.indicator);
      if (!Number.isNaN(indicatorId)) ids.add(indicatorId);
    }
    nextUrl = data?.next || null;
  }
  return ids;
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? undefined : n;
};

const AGE_BANDS = [
  "10-14",
  "15-19",
  "20-24",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65+",
];

const parseSex = (value) => {
  const v = normalize(value);
  if (v === "male" || v === "m") return "Male";
  if (v === "female" || v === "f") return "Female";
  return null;
};

const sumDisaggregatesBySex = (disaggregates, sex) => {
  let sum = 0;
  for (const kpData of Object.values(disaggregates || {})) {
    const values = (kpData && kpData[sex]) || {};
    for (const band of AGE_BANDS) {
      sum += Number(values[band] || 0);
    }
  }
  return sum;
};

const firstNumeric = (row, startIndex = 0) => {
  for (let i = startIndex; i < row.length; i += 1) {
    const n = parseNumber(row[i]);
    if (n !== undefined) return n;
  }
  return undefined;
};

const resolveOrgId = (sheetName, organizations) => {
  const key = normalize(sheetName);
  const aliased = ORG_ALIASES[key] || Object.entries(ORG_ALIASES).find(([alias]) => key.includes(alias))?.[1];
  if (aliased) {
    const match = organizations.find((o) => normalize(o.name) === normalize(aliased));
    if (match) return Number(match.id);
  }

  const exact = organizations.find((o) => normalize(o.name) === key);
  if (exact) return Number(exact.id);

  const fuzzy = organizations.find((o) => key.includes(normalize(o.name)) || normalize(o.name).includes(key));
  if (fuzzy) return Number(fuzzy.id);

  return null;
};

const isIndicatorCode = (value) => /^\d+[a-z]?$/i.test(String(value || "").trim());
const isNumericRowIndex = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^\d+$/.test(raw);
};
const isIndicatorRowStart = (value) => isIndicatorCode(value) || isNumericRowIndex(value);
const detectRowBase = (row) => {
  const col0 = String(row?.[0] || "").trim();
  const col1 = String(row?.[1] || "").trim();
  if (!col0 && isIndicatorRowStart(col1)) return 1;
  return 0;
};

const resolveIndicatorId = (name, indicatorIdByCanonical) => {
  const candidates = new Set();
  const raw = String(name || "").trim();
  if (!raw) return null;

  candidates.add(canonicalIndicatorKey(raw));
  candidates.add(canonicalIndicatorKey(`Number of ${raw}`));

  if (/^total\s+number\s+of\s+/i.test(raw)) {
    candidates.add(canonicalIndicatorKey(`Number of ${raw}`));
  }

  if (/^number\s+(eligible|referred)\b/i.test(raw)) {
    candidates.add(canonicalIndicatorKey(`Number of ${raw}`));
  }

  if (/^hiv\s+prevention\s+messages$/i.test(raw)) {
    candidates.add(canonicalIndicatorKey(`Number of ${raw}`));
  }

  for (const key of candidates) {
    if (indicatorIdByCanonical.has(key)) {
      return indicatorIdByCanonical.get(key);
    }
  }

  return null;
};

const main = async () => {
  console.log("Loading organizations/projects/indicators...");
  const [organizations, projects, indicators] = await Promise.all([
    listAll("/organizations/"),
    listAll("/manage/projects/"),
    listAll("/indicators/"),
  ]);

  const projectId =
    DEFAULT_PROJECT_ID ||
    projects.find((p) => normalize(p.name).includes("nahpa"))?.id ||
    projects[0]?.id ||
    null;

  if (!projectId) throw new Error("No project found. Set DEFAULT_PROJECT_ID.");

  const indicatorIdByCanonical = new Map();
  for (const indicator of indicators) {
    const key = canonicalIndicatorKey(indicator.name);
    if (key && !indicatorIdByCanonical.has(key)) {
      indicatorIdByCanonical.set(key, Number(indicator.id));
    }
  }

  console.log("Reading workbook...");
  const workbook = XLSX.readFile(SOURCE_PATH);

  const groups = new Map();
  const unknownIndicators = new Map();
  const unknownSheets = [];

  let matchedRows = 0;
  let skippedUnknownIndicator = 0;

  for (const sheetName of workbook.SheetNames) {
    if (normalize(sheetName) === "drop down") continue;

    const organizationId = resolveOrgId(sheetName, organizations) || DEFAULT_ORGANIZATION_ID;
    if (!organizationId) {
      unknownSheets.push(sheetName);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const base = detectRowBase(row);
      const code = String(row[base] || "").trim();
      const name = String(row[base + 1] || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

      if (!isIndicatorRowStart(code) || !name) continue;

      const indicatorId = resolveIndicatorId(name, indicatorIdByCanonical);
      if (!indicatorId) {
        skippedUnknownIndicator += 1;
        unknownIndicators.set(name, (unknownIndicators.get(name) || 0) + 1);
        continue;
      }

      let male;
      let female;
      let total = parseNumber(row[18]) ?? parseNumber(row[17]);
      const disaggregates = {};

      for (let j = i + 1; j < Math.min(i + 25, rows.length); j += 1) {
        const probe = rows[j] || [];
        const probeCode = String(probe[base] || "").trim();
        if (isIndicatorRowStart(probeCode)) break;

        const label = normalize(probe[base + 3]);
        const kpRaw = String(probe[base + 3] || "").trim();
        const sex = parseSex(probe[base + 4]);

        if (label === "total male") male = firstNumeric(probe, base + 5);
        if (label === "total female") female = firstNumeric(probe, base + 5);
        if ((label === "sub total" || label === "total") && total === undefined) {
          total = parseNumber(probe[base + 18]) ?? parseNumber(probe[base + 17]) ?? firstNumeric(probe, base + 5);
        }

        if (!kpRaw || !sex) continue;
        if (["age sex", "sub total", "total", "total male", "total female"].includes(label)) continue;

        if (!disaggregates[kpRaw]) {
          disaggregates[kpRaw] = { Male: {}, Female: {} };
        }

        AGE_BANDS.forEach((band, idx) => {
          const valueAtBand = parseNumber(probe[base + 5 + idx]);
          if (valueAtBand !== undefined) {
            disaggregates[kpRaw][sex][band] = valueAtBand;
          }
        });

        const ayp = parseNumber(probe[base + 19]);
        if (ayp !== undefined) {
          disaggregates[kpRaw][sex]["AYP (10-24)"] = ayp;
        }
      }

      if (male === undefined) male = sumDisaggregatesBySex(disaggregates, "Male");
      if (female === undefined) female = sumDisaggregatesBySex(disaggregates, "Female");
      if (total === undefined && male !== undefined && female !== undefined) {
        total = male + female;
      }
      if (total === undefined && male === undefined && female === undefined) {
        total = 0;
      }

      const value = {
        ...(male !== undefined ? { male } : {}),
        ...(female !== undefined ? { female } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(Object.keys(disaggregates).length > 0 ? { disaggregates } : {}),
      };

      const key = `${projectId}::${organizationId}::${DEFAULT_PERIOD_START}::${DEFAULT_PERIOD_END}`;
      if (!groups.has(key)) {
        groups.set(key, {
          project: Number(projectId),
          organization: Number(organizationId),
          period_start: DEFAULT_PERIOD_START,
          period_end: DEFAULT_PERIOD_END,
          data: [],
        });
      }

      groups.get(key).data.push({
        indicator: Number(indicatorId),
        value,
        notes: `Imported from ${path.basename(SOURCE_PATH)} | sheet=${sheetName} | code=${code}`,
      });
      matchedRows += 1;
    }
  }

  for (const group of groups.values()) {
    const byIndicator = new Map();
    for (const item of group.data) byIndicator.set(Number(item.indicator), item);
    group.data = Array.from(byIndicator.values());
  }

  let createdTotal = 0;
  let skippedExisting = 0;
  let failedGroups = 0;

  for (const [key, group] of groups.entries()) {
    try {
      const existingIndicatorIds = await listExistingIndicatorIds(group);
      const filteredData = group.data.filter((item) => !existingIndicatorIds.has(Number(item.indicator)));

      if (filteredData.length === 0) {
        skippedExisting += group.data.length;
        console.log(`SKIP| ${key} -> all indicators already have aggregates`);
        continue;
      }

      const payload = { ...group, data: filteredData };
      const result = await apiPostJson(`${API_BASE}/aggregates/bulk_create/`, payload);
      const created = Number(result?.created || filteredData.length || 0);
      createdTotal += created;
      console.log(`OK  | ${key} -> created=${created}`);
    } catch (error) {
      failedGroups += 1;
      console.error(`ERR | ${key} -> ${String(error?.message || error)}`);
    }
  }

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const unknownIndicatorList = Array.from(unknownIndicators.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(reportsDir, "aggregate-import-unknown-indicators.json"), JSON.stringify(unknownIndicatorList, null, 2));

  console.log("\n=== AGGREGATE IMPORT SUMMARY (NO NEW INDICATORS) ===");
  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Project ID: ${projectId}`);
  console.log(`Period: ${DEFAULT_PERIOD_START} to ${DEFAULT_PERIOD_END}`);
  console.log(`Groups: ${groups.size}`);
  console.log(`Matched indicator rows: ${matchedRows}`);
  console.log(`Created aggregates: ${createdTotal}`);
  console.log(`Skipped (unknown indicator rows): ${skippedUnknownIndicator}`);
  console.log(`Skipped (already existing): ${skippedExisting}`);
  console.log(`Unknown sheets: ${unknownSheets.length}`);
  console.log(`Failed groups: ${failedGroups}`);
  console.log(`Unknown indicators report: reports/aggregate-import-unknown-indicators.json`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
