import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import XLSX from "xlsx-js-style";

const ZIP_PATH = process.env.CSO_ZIP_PATH || "C:/Users/dekok/Downloads/CSOs Reports (2).zip";
const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ORG_ALIASES = {
  boad: "Botswana Association for the Deaf",
  bsd: "Botswana Society for the Disabled",
  bti: "Botswana Trans Initiative",
  babps: "Botswana Association for the Blind and Partially Sighted",
  mwautumwaya: "Mwatumwaya Rehabilitation Centre",
  mwatumwaya: "Mwatumwaya Rehabilitation Centre",
  madikwe: "Madikwe Community Trust",
  "men for health": "Men for Health and Gender Justice Org.",
  nkaikela: "Nkaikela Youth Group",
  "silence kills": "Silence Kills Support Group",
};

const findOrganizationByAlias = (text, organizations) => {
  const source = normalize(text);
  if (!source) return null;

  const aliasEntries = Object.entries(ORG_ALIASES);
  for (const [alias, orgName] of aliasEntries) {
    if (!source.includes(normalize(alias))) continue;
    const match = organizations.find((org) => normalize(org.name) === normalize(orgName));
    if (match) return match;
  }

  return null;
};

const findOrganizationByKeywordOverlap = (text, organizations) => {
  const source = normalize(text);
  if (!source) return null;
  const sourceTokens = new Set(source.split(" ").filter((token) => token.length >= 3));
  if (sourceTokens.size === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const org of organizations) {
    const orgTokens = normalize(org.name)
      .split(" ")
      .filter((token) => token.length >= 3 && !["org", "group", "support", "centre"].includes(token));
    if (orgTokens.length === 0) continue;

    let matches = 0;
    for (const token of orgTokens) {
      if (sourceTokens.has(token)) matches += 1;
    }

    if (matches > bestScore && matches >= 2) {
      best = org;
      bestScore = matches;
    }
  }

  return best;
};

const authHeaders = () => ({
  Authorization: `Bearer ${TOKEN}`,
});

const apiGetJson = async (url) => {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return response.json();
};

const listAllOrganizations = async () => {
  const orgs = [];
  let nextUrl = `${API_BASE}/organizations/?page_size=500`;
  while (nextUrl) {
    const data = await apiGetJson(nextUrl);
    const results = Array.isArray(data?.results) ? data.results : [];
    orgs.push(...results);
    nextUrl = data?.next || null;
  }
  return orgs;
};

const inferOrganization = (entryPath, organizations) => {
  const parts = entryPath.split("/").map(normalize).filter(Boolean).reverse();

  const aliasFromPath = findOrganizationByAlias(entryPath, organizations);
  if (aliasFromPath) return aliasFromPath;

  for (const part of parts) {
    const exact = organizations.find((org) => normalize(org.name) === part);
    if (exact) return exact;
  }

  for (const part of parts) {
    const fuzzy = organizations.find((org) => {
      const orgName = normalize(org.name);
      return part.includes(orgName) || (part.length >= 5 && orgName.includes(part));
    });
    if (fuzzy) return fuzzy;
  }

  const overlap = findOrganizationByKeywordOverlap(entryPath, organizations);
  if (overlap) return overlap;

  return null;
};

const inferOrganizationFromSheetNames = (fileBuffer, organizations) => {
  try {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheets = (workbook.SheetNames || []).map((name) => normalize(name)).filter(Boolean);

    const joinedSheets = sheets.join(" ");
    const aliasFromSheets = findOrganizationByAlias(joinedSheets, organizations);
    if (aliasFromSheets) return aliasFromSheets;

    for (const sheetName of sheets) {
      const exact = organizations.find((org) => normalize(org.name) === sheetName);
      if (exact) return exact;
    }

    for (const sheetName of sheets) {
      const fuzzy = organizations.find((org) => {
        const orgName = normalize(org.name);
        return sheetName.includes(orgName) || (sheetName.length >= 5 && orgName.includes(sheetName));
      });
      if (fuzzy) return fuzzy;
    }

    const overlap = findOrganizationByKeywordOverlap(joinedSheets, organizations);
    if (overlap) return overlap;
  } catch {
    return null;
  }

  return null;
};

const uploadFile = async ({ fileName, fileBuffer, orgId }) => {
  const form = new FormData();
  const blob = new Blob([fileBuffer]);
  form.append("name", fileName);
  form.append("file", blob, fileName);
  form.append("description", "Bulk imported from CSO ZIP archive");
  if (orgId) form.append("organization", String(orgId));

  const response = await fetch(`${API_BASE}/uploads/`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}) for ${fileName}: ${JSON.stringify(payload)}`);
  }

  return payload;
};

const startImport = async (uploadId) => {
  const response = await fetch(`${API_BASE}/uploads/${uploadId}/start_import/`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Import start failed (${response.status}) for upload ${uploadId}: ${JSON.stringify(payload)}`);
  }

  return payload;
};

const shouldImportEntry = (entryName) => {
  const ext = path.extname(entryName).toLowerCase();
  return [".xlsx", ".xls", ".xlsm", ".csv"].includes(ext);
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

const main = async () => {
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error(`ZIP not found: ${ZIP_PATH}`);
  }

  console.log("Loading organizations...");
  const organizations = await listAllOrganizations();
  console.log(`Organizations loaded: ${organizations.length}`);

  console.log("Reading ZIP...");
  const rootBuffer = fs.readFileSync(ZIP_PATH);
  const entries = await collectEntries(rootBuffer);
  console.log(`Spreadsheet entries found: ${entries.length}`);

  let uploaded = 0;
  let importStarted = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const ext = path.extname(entry.fileName).toLowerCase();
      let org = inferOrganization(entry.fullPath, organizations);
      if (!org && [".xlsx", ".xls", ".xlsm"].includes(ext)) {
        org = inferOrganizationFromSheetNames(entry.content, organizations);
      }
      const upload = await uploadFile({
        fileName: entry.fileName,
        fileBuffer: entry.content,
        orgId: org ? Number(org.id) : null,
      });
      uploaded += 1;

      const isSpreadsheet = ["spreadsheet", "other"].includes(String(upload?.file_type || "").toLowerCase())
        || /\.(xlsx|xls|xlsm|csv)$/i.test(entry.fileName);

      if (isSpreadsheet && upload?.id) {
        await startImport(upload.id);
        importStarted += 1;
      }

      console.log(`OK  | ${entry.fullPath} -> org=${org?.name || "(unmatched)"} uploadId=${upload?.id ?? "?"}`);
    } catch (error) {
      failed += 1;
      console.error(`ERR | ${entry.fullPath} -> ${String(error?.message || error)}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Import started: ${importStarted}`);
  console.log(`Failed: ${failed}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
