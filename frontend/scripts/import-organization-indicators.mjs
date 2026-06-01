import XLSX from "xlsx-js-style";
import fs from "node:fs";
import path from "node:path";

const SOURCE_PATH = process.env.INDICATOR_XLSX_PATH || "C:/Users/dekok/Downloads/Organisation_Indicators.xlsx";
const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

if (!fs.existsSync(SOURCE_PATH)) {
  console.error(`Source file not found: ${SOURCE_PATH}`);
  process.exit(1);
}

const ORG_ALIASES = {
  boad: "Botswana Association for the Deaf",
  bsd: "Botswana Society for the Disabled",
  bti: "Botswana Trans Initiative",
  babps: "Botswana Association for the Blind and Partially Sighted",
  mwatumwaya: "Mwatumwaya Rehabilitation Centre",
  madikwe: "Madikwe Community Trust",
  "men for health": "Men for Health and Gender Justice Org.",
  "men and boys": "men and boys",
  "social dialogue": "Social Dialogue",
  sentebale: "Sentebale",
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

const apiCreate = async (body) => {
  const response = await fetch(`${API_BASE}/indicators/`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`POST /indicators failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const apiPatch = async (id, body) => {
  const response = await fetch(`${API_BASE}/indicators/${id}/`, {
    method: "PATCH",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PATCH /indicators/${id} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const makeIndicatorCode = (name, existingCodes) => {
  const base = String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34) || "AUTO_INDICATOR";

  let candidate = `AUTO_${base}`.slice(0, 50);
  let index = 1;
  while (existingCodes.has(normalize(candidate))) {
    const suffix = `_${index}`;
    const maxBase = 50 - 5 - suffix.length;
    candidate = `AUTO_${base.slice(0, maxBase)}${suffix}`;
    index += 1;
  }
  existingCodes.add(normalize(candidate));
  return candidate;
};

const resolveOrgId = (orgName, organizations) => {
  const key = normalize(orgName);
  if (!key) return null;

  const aliasedName = ORG_ALIASES[key] || Object.entries(ORG_ALIASES).find(([alias]) => key.includes(alias))?.[1];
  if (aliasedName) {
    const match = organizations.find((org) => normalize(org.name) === normalize(aliasedName));
    if (match) return Number(match.id);
  }

  const exact = organizations.find((org) => normalize(org.name) === key);
  if (exact) return Number(exact.id);

  const fuzzy = organizations.find((org) => {
    const orgNameNorm = normalize(org.name);
    return key.includes(orgNameNorm) || orgNameNorm.includes(key);
  });
  if (fuzzy) return Number(fuzzy.id);

  return null;
};

const main = async () => {
  console.log("Loading workbook...");
  const workbook = XLSX.readFile(SOURCE_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (!rows.length) throw new Error("Workbook is empty.");

  const header = rows[0].map((v) => normalize(v));
  const orgIdx = header.findIndex((h) => h === "organisation" || h === "organization" || h === "org");
  const indicatorIdx = header.findIndex((h) => h === "indicator" || h === "indicator name");

  if (orgIdx < 0 || indicatorIdx < 0) {
    throw new Error(`Could not find required columns. Header: ${JSON.stringify(rows[0])}`);
  }

  console.log("Loading existing indicators and organizations...");
  const [existingIndicators, organizations] = await Promise.all([listAll("/indicators/"), listAll("/organizations/")]);

  const byCanonical = new Map();
  const existingCodes = new Set();
  for (const indicator of existingIndicators) {
    const canonical = canonicalIndicatorKey(indicator.name);
    if (canonical && !byCanonical.has(canonical)) byCanonical.set(canonical, indicator);
    existingCodes.add(normalize(indicator.code));
  }

  const extracted = new Map();
  const unmatchedOrganizations = new Map();
  let scannedRows = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const orgName = String(row[orgIdx] || "").trim();
    const indicatorName = String(row[indicatorIdx] || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

    if (!orgName || !indicatorName) continue;
    scannedRows += 1;

    const orgId = resolveOrgId(orgName, organizations);
    if (!orgId) {
      unmatchedOrganizations.set(orgName, (unmatchedOrganizations.get(orgName) || 0) + 1);
      continue;
    }

    const key = canonicalIndicatorKey(indicatorName);
    if (!key) continue;

    if (!extracted.has(key)) {
      extracted.set(key, {
        name: indicatorName,
        organizations: new Set(),
      });
    }

    extracted.get(key).organizations.add(orgId);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [key, data] of extracted.entries()) {
    const orgIds = Array.from(data.organizations);
    try {
      if (byCanonical.has(key)) {
        const existing = byCanonical.get(key);
        const existingOrgs = Array.isArray(existing.organizations)
          ? existing.organizations.map((v) => Number(v)).filter((v) => !Number.isNaN(v))
          : [];
        const mergedOrgs = Array.from(new Set([...existingOrgs, ...orgIds]));

        const needsOrgUpdate = mergedOrgs.length !== existingOrgs.length;
        const needsActiveUpdate = existing.is_active === false;

        if (!needsOrgUpdate && !needsActiveUpdate) {
          skipped += 1;
          continue;
        }

        if (!DRY_RUN) {
          await apiPatch(existing.id, {
            ...(needsOrgUpdate ? { organizations: mergedOrgs } : {}),
            ...(needsActiveUpdate ? { is_active: true } : {}),
          });
        }
        updated += 1;
        continue;
      }

      const code = makeIndicatorCode(data.name, existingCodes);
      const payload = {
        name: data.name,
        code,
        category: "hiv_prevention",
        type: "number",
        aggregation_method: "sum",
        sub_labels: [],
        organizations: orgIds,
        is_active: true,
      };

      if (!DRY_RUN) {
        const createdIndicator = await apiCreate(payload);
        byCanonical.set(key, createdIndicator);
      }
      created += 1;
    } catch (error) {
      failed += 1;
      console.error(`ERR | ${data.name} -> ${String(error?.message || error)}`);
    }
  }

  const unmatched = Array.from(unmatchedOrganizations.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "organisation-indicator-unmatched-orgs.json"), JSON.stringify(unmatched, null, 2));

  console.log("\n=== ORGANISATION INDICATOR IMPORT SUMMARY ===");
  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Rows scanned: ${scannedRows}`);
  console.log(`Unique indicators in file: ${extracted.size}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Unmatched organizations: ${unmatched.length}`);
  console.log(`Unmatched report: reports/organisation-indicator-unmatched-orgs.json`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
