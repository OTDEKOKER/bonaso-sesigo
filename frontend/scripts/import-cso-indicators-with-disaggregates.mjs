import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import XLSX from "xlsx-js-style";

const SOURCE_PATH = process.env.CSO_SOURCE_PATH || "C:/Users/dekok/Downloads/CSOs Reports (2).zip";
const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const NUMBER_ONLY = String(process.env.NUMBER_OF_ONLY || "true").toLowerCase() !== "false";
const NUMBER_PREFIX_REGEX = /^number of\b/i;
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";
const INCLUDE_DESCENDANTS = String(process.env.INCLUDE_DESCENDANTS || "false").toLowerCase() === "true";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const canonicalIndicatorKey = (value) =>
  normalize(value)
    .replace(/\bnunber\b/g, "number")
    .trim();

const ORG_ALIASES = {
  boad: "Botswana Association for the Deaf",
  bsd: "Botswana Society for the Disabled",
  bti: "Botswana Trans Initiative",
  babps: "Botswana Association for the Blind and Partially Sighted",
  mwatumwaya: "Mwatumwaya Rehabilitation Centre",
  madikwe: "Madikwe Community Trust",
  "men for health": "Men for Health and Gender Justice Org.",
  nkaikela: "Nkaikela Youth Group",
  "silence kills": "Silence Kills Support Group",
};

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const toTitle = (value) => {
  const cleaned = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(" ");
};

const splitDisaggregates = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(/\||,|;|\/|\\n|\\r/) 
    .map((item) => item.trim())
    .filter(Boolean)
    .map(toTitle)
    .filter(Boolean);
};

const DISAGGREGATE_GROUPS = {
  SEX: "Sex",
  AGE_RANGE: "Age Range",
  KP: "KP",
  FAMILY_PLANNING: "Family Planning",
  COMMUNITY_LEADERS: "Community Leaders",
  NON_TRADITIONAL_SITES: "Non Traditional Sites",
  SOCIAL_MEDIA_PLATFORM: "Social Media Platform",
  NCD_SCREENING: "NCD Screening",
};

const mapDisaggregatesToGroups = (values) => {
  const groups = new Set();
  for (const value of values || []) {
    const item = normalize(value);
    if (!item) continue;

    if (["female", "male", "sex", "gender"].includes(item)) {
      groups.add(DISAGGREGATE_GROUPS.SEX);
    }

    if (
      item === "age range" ||
      /^\d{1,2}\s*-\s*\d{1,2}$/.test(item) ||
      item === "65" ||
      item === "65+" ||
      item.includes("ayp")
    ) {
      groups.add(DISAGGREGATE_GROUPS.AGE_RANGE);
    }

    if (
      ["kp", "key population", "key populations", "fsw", "msm", "lgbtqi", "lgbtqi+", "pwd", "pwids"].includes(
        item,
      )
    ) {
      groups.add(DISAGGREGATE_GROUPS.KP);
    }

    if (item.includes("family planning")) {
      groups.add(DISAGGREGATE_GROUPS.FAMILY_PLANNING);
    }

    if (item.includes("community leader")) {
      groups.add(DISAGGREGATE_GROUPS.COMMUNITY_LEADERS);
    }

    if (item.includes("non traditional") && item.includes("site")) {
      groups.add(DISAGGREGATE_GROUPS.NON_TRADITIONAL_SITES);
    }

    if (item.includes("social media") && item.includes("platform")) {
      groups.add(DISAGGREGATE_GROUPS.SOCIAL_MEDIA_PLATFORM);
    }

    if (item.includes("ncd") && item.includes("screen")) {
      groups.add(DISAGGREGATE_GROUPS.NCD_SCREENING);
    }
  }

  return Array.from(groups);
};

const startsWithNumberOf = (value) => {
  return NUMBER_PREFIX_REGEX.test(String(value || "").trim());
};

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

const shouldImportEntry = (entryName) => {
  const ext = path.extname(entryName).toLowerCase();
  return [".xlsx", ".xls", ".xlsm"].includes(ext);
};

const collectEntries = async (sourcePath) => {
  const ext = path.extname(sourcePath).toLowerCase();

  if ([".xlsx", ".xls", ".xlsm"].includes(ext)) {
    return [
      {
        fullPath: sourcePath,
        fileName: path.basename(sourcePath),
        content: fs.readFileSync(sourcePath),
      },
    ];
  }

  if (ext !== ".zip") {
    throw new Error(`Unsupported source type: ${ext}. Use .zip or .xlsx/.xls/.xlsm`);
  }

  const readZipEntries = async (zipBuffer, prefix = "") => {
    const zip = await JSZip.loadAsync(zipBuffer);
    const files = [];

    for (const entry of Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.dir) continue;
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const nestedExt = path.extname(entry.name).toLowerCase();

      if (nestedExt === ".zip") {
        const nestedBuffer = Buffer.from(await entry.async("uint8array"));
        const nested = await readZipEntries(nestedBuffer, fullPath);
        files.push(...nested);
        continue;
      }

      if (!shouldImportEntry(entry.name)) continue;
      const content = Buffer.from(await entry.async("uint8array"));
      files.push({ fullPath, fileName: path.basename(entry.name), content });
    }

    return files;
  };

  const rootBuffer = fs.readFileSync(sourcePath);
  return readZipEntries(rootBuffer);
};

const detectHeader = (rows) => {
  let bestIndex = -1;
  let bestScore = -1;

  const scanLimit = Math.min(rows.length, 40);
  for (let i = 0; i < scanLimit; i += 1) {
    const header = (rows[i] || []).map((cell) => normalizeHeader(cell));
    if (!header.some(Boolean)) continue;

    const hasIndicator = header.some((h) => h === "indicator" || h === "indicator_name" || h === "indicator_definition");
    const hasDisaggregation = header.some((h) => h.includes("disagg") || h === "variables" || h === "variable_description");

    let score = 0;
    if (hasIndicator) score += 2;
    if (hasDisaggregation) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < 2) return null;
  return {
    header: (rows[bestIndex] || []).map((cell) => normalizeHeader(cell)),
    dataRows: rows.slice(bestIndex + 1),
  };
};

const extractTemplateStyleRows = (rows) => {
  const items = [];
  let current = null;

  for (const row of rows) {
    const col0 = String(row?.[0] ?? "").trim();
    const col1 = String(row?.[1] ?? "").trim();
    const col3 = String(row?.[3] ?? "").trim();

    const hasNumericIndex = col0 !== "" && !Number.isNaN(Number(col0));
    if (hasNumericIndex && col1.length >= 3) {
      current = {
        indicatorName: col1,
        disaggregates: [],
      };
      if (col3 && normalize(col3) !== "total") {
        current.disaggregates.push(col3);
      }
      items.push(current);
      continue;
    }

    if (current && !col0 && !col1 && col3 && normalize(col3) !== "total") {
      current.disaggregates.push(col3);
    }
  }

  return items;
};

const getByAliases = (row, header, aliases) => {
  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx >= 0) {
      const value = String(row[idx] ?? "").trim();
      if (value) return value;
    }
  }
  return "";
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

const inferOrganizationId = (entryPath, organizations) => {
  const source = normalize(entryPath);
  const parts = entryPath.split("/").map(normalize).filter(Boolean).reverse();

  for (const [alias, orgName] of Object.entries(ORG_ALIASES)) {
    if (!source.includes(normalize(alias))) continue;
    const match = organizations.find((org) => normalize(org.name) === normalize(orgName));
    if (match) return Number(match.id);
  }

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

const inferOrganizationIdFromSheetNames = (sheetNames, organizations) => {
  const normalizedSheets = (sheetNames || []).map((name) => normalize(name)).filter(Boolean);
  if (normalizedSheets.length === 0) return null;

  const joined = normalizedSheets.join(" ");
  for (const [alias, orgName] of Object.entries(ORG_ALIASES)) {
    if (!joined.includes(normalize(alias))) continue;
    const match = organizations.find((org) => normalize(org.name) === normalize(orgName));
    if (match) return Number(match.id);
  }

  for (const sheet of normalizedSheets) {
    const exact = organizations.find((org) => normalize(org.name) === sheet);
    if (exact) return Number(exact.id);
  }

  for (const sheet of normalizedSheets) {
    const fuzzy = organizations.find((org) => {
      const orgName = normalize(org.name);
      return sheet.includes(orgName) || (sheet.length >= 5 && orgName.includes(sheet));
    });
    if (fuzzy) return Number(fuzzy.id);
  }

  return null;
};

const main = async () => {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`Source not found: ${SOURCE_PATH}`);
  }

  console.log("Loading indicators and organizations...");
  const [existingIndicators, organizations] = await Promise.all([
    listAll("/indicators/"),
    listAll("/organizations/"),
  ]);

  const byName = new Map();
  const byCanonical = new Map();
  const existingCodes = new Set();
  for (const indicator of existingIndicators) {
    const nameKey = normalize(indicator.name);
    if (nameKey) byName.set(nameKey, indicator);
    const canonicalKey = canonicalIndicatorKey(indicator.name);
    if (canonicalKey && !byCanonical.has(canonicalKey)) byCanonical.set(canonicalKey, indicator);
    existingCodes.add(normalize(indicator.code));
  }

  const childrenByParent = new Map();
  for (const org of organizations) {
    const parentId = String(org.parentId ?? org.parent ?? "").trim();
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) || [];
    list.push(String(org.id));
    childrenByParent.set(parentId, list);
  }

  const getOrgScopeIds = (rootOrgId) => {
    const rootId = String(rootOrgId || "").trim();
    if (!rootId) return [];
    if (!INCLUDE_DESCENDANTS) return [Number(rootId)];

    const visited = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const children = childrenByParent.get(current) || [];
      for (const childId of children) {
        if (visited.has(childId)) continue;
        visited.add(childId);
        queue.push(childId);
      }
    }

    return Array.from(visited)
      .map((value) => Number(value))
      .filter((value) => !Number.isNaN(value));
  };

  const entries = await collectEntries(SOURCE_PATH);
  console.log(`Template files found: ${entries.length}`);

  const extracted = new Map();
  let scannedRows = 0;

  for (const entry of entries) {
    const workbook = XLSX.read(entry.content, { type: "buffer" });
    const fallbackOrgId =
      inferOrganizationId(entry.fullPath, organizations) ||
      inferOrganizationIdFromSheetNames(workbook.SheetNames, organizations);

    for (const sheetName of workbook.SheetNames) {
      const sheetOrgId =
        inferOrganizationIdFromSheetNames([sheetName], organizations) ||
        fallbackOrgId;
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).map((row) =>
        row.map((cell) => (cell === undefined || cell === null ? "" : String(cell)))
      );

      const context = detectHeader(rows);
      if (!context) {
        const templateItems = extractTemplateStyleRows(rows);
        for (const item of templateItems) {
          scannedRows += 1;
          const indicatorName = toTitle(item.indicatorName);
          if (!indicatorName || indicatorName.length < 3) continue;
          if (NUMBER_ONLY && !startsWithNumberOf(indicatorName)) continue;

          const disaggregates = item.disaggregates.map((value) => toTitle(value)).filter(Boolean);
          const key = canonicalIndicatorKey(indicatorName);
          if (!key) continue;

          if (!extracted.has(key)) {
            extracted.set(key, {
              name: indicatorName,
              disaggregates: new Set(),
              organizations: new Set(),
            });
          }

          const bucket = extracted.get(key);
          for (const value of disaggregates) bucket.disaggregates.add(value);
          if (sheetOrgId) {
            const scopedOrgIds = getOrgScopeIds(sheetOrgId);
            for (const orgId of scopedOrgIds) bucket.organizations.add(orgId);
          }
        }
        continue;
      }

      const { header, dataRows } = context;

      for (const row of dataRows) {
        if (!row.some((cell) => String(cell || "").trim())) continue;
        scannedRows += 1;

        const indicatorNameRaw = getByAliases(row, header, [
          "indicator_name",
          "indicator",
          "indicator_definition",
        ]);

        const indicatorName = toTitle(indicatorNameRaw);
        if (!indicatorName || indicatorName.length < 3) continue;
        if (NUMBER_ONLY && !startsWithNumberOf(indicatorName)) continue;

        const disaggregationRaw = [
          getByAliases(row, header, ["disaggregation", "dissagregation", "disaggregate", "disaggregates"]),
          getByAliases(row, header, ["variables", "variable", "variable_description"]),
        ]
          .filter(Boolean)
          .join(" | ");

        const disaggregates = splitDisaggregates(disaggregationRaw);

        const key = canonicalIndicatorKey(indicatorName);
        if (!key) continue;

        if (!extracted.has(key)) {
          extracted.set(key, {
            name: indicatorName,
            disaggregates: new Set(),
            organizations: new Set(),
          });
        }

        const bucket = extracted.get(key);
        for (const item of disaggregates) bucket.disaggregates.add(item);
        if (sheetOrgId) {
          const scopedOrgIds = getOrgScopeIds(sheetOrgId);
          for (const orgId of scopedOrgIds) bucket.organizations.add(orgId);
        }
      }
    }
  }

  console.log(`Rows scanned: ${scannedRows}`);
  console.log(`Filter active (Number of only): ${NUMBER_ONLY}`);
  console.log(`Include descendants: ${INCLUDE_DESCENDANTS}`);
  console.log(`Unique indicators extracted: ${extracted.size}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;

  for (const [key, info] of extracted.entries()) {
    try {
      const disaggregates = Array.from(info.disaggregates);
      const disaggregateGroups = mapDisaggregatesToGroups(disaggregates);
      const orgIds = Array.from(info.organizations);

      if (byCanonical.has(key) || byName.has(key)) {
        const existing = byCanonical.get(key) || byName.get(key);
        const existingSubLabels = Array.isArray(existing.sub_labels) ? existing.sub_labels : [];
        const mergedSubLabels = Array.from(new Set([...existingSubLabels, ...disaggregateGroups]));

        const existingOrgs = Array.isArray(existing.organizations)
          ? existing.organizations.map((value) => Number(value)).filter((value) => !Number.isNaN(value))
          : [];
        const mergedOrgs = Array.from(new Set([...existingOrgs, ...orgIds]));

        const needsSubLabelUpdate = mergedSubLabels.length !== existingSubLabels.length;
        const needsOrgUpdate = mergedOrgs.length !== existingOrgs.length;

        if (!needsSubLabelUpdate && !needsOrgUpdate) {
          if (DRY_RUN) {
            wouldSkip += 1;
            continue;
          }
          skipped += 1;
          continue;
        }

        if (DRY_RUN) {
          wouldUpdate += 1;
          continue;
        }

        await apiPatch(existing.id, {
          ...(needsSubLabelUpdate ? { sub_labels: mergedSubLabels } : {}),
          ...(needsOrgUpdate ? { organizations: mergedOrgs } : {}),
        });
        updated += 1;
        continue;
      }

      const code = makeIndicatorCode(info.name, existingCodes);
      const payload = {
        name: info.name,
        code,
        category: "hiv_prevention",
        type: disaggregateGroups.length ? "multi_int" : "number",
        aggregation_method: "sum",
        sub_labels: disaggregateGroups,
        organizations: orgIds,
      };

      if (DRY_RUN) {
        wouldCreate += 1;
        continue;
      }

      const createdIndicator = await apiCreate(payload);
      byName.set(key, createdIndicator);
      byCanonical.set(key, createdIndicator);
      created += 1;
    } catch (error) {
      failed += 1;
      console.error(`ERR | ${info.name} -> ${String(error?.message || error)}`);
    }
  }

  console.log("\n=== INDICATOR IMPORT SUMMARY ===");
  if (DRY_RUN) {
    console.log("Mode: DRY_RUN (no changes applied)");
    console.log(`Would create: ${wouldCreate}`);
    console.log(`Would update: ${wouldUpdate}`);
    console.log(`Would skip: ${wouldSkip}`);
    console.log(`Would fail: ${failed}`);
    return;
  }
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
