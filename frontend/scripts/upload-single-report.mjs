import fs from "node:fs";
import path from "node:path";

const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const REPORT_FILE_PATH = process.env.REPORT_FILE_PATH || "";
const ORG_NAME = process.env.ORG_NAME || "TEBELOPELE";

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

if (!REPORT_FILE_PATH || !fs.existsSync(REPORT_FILE_PATH)) {
  console.error(`Report file missing: ${REPORT_FILE_PATH}`);
  process.exit(1);
}

const authHeaders = () => ({
  Authorization: `Bearer ${TOKEN}`,
});

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const listAll = async (endpoint) => {
  const items = [];
  let nextUrl = `${API_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}page_size=500`;
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers: authHeaders() });
    if (!response.ok) throw new Error(`GET ${nextUrl} failed: ${response.status}`);
    const data = await response.json();
    items.push(...(Array.isArray(data?.results) ? data.results : []));
    nextUrl = data?.next || null;
  }
  return items;
};

const uploadFile = async ({ fileName, fileBuffer, organizationId }) => {
  const form = new FormData();
  const blob = new Blob([fileBuffer]);
  form.append("name", fileName);
  form.append("file", blob, fileName);
  form.append("description", "Single report upload for aggregate import");
  if (organizationId) form.append("organization", String(organizationId));

  const response = await fetch(`${API_BASE}/uploads/`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${JSON.stringify(payload)}`);
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
    throw new Error(`Import start failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
};

const main = async () => {
  const organizations = await listAll("/organizations/");
  const org = organizations.find((o) => normalize(o.name) === normalize(ORG_NAME));
  if (!org) {
    throw new Error(`Organization not found: ${ORG_NAME}`);
  }

  const fileName = path.basename(REPORT_FILE_PATH);
  const fileBuffer = fs.readFileSync(REPORT_FILE_PATH);

  console.log(`Uploading ${fileName} for organization ${org.name} (ID ${org.id})...`);
  const upload = await uploadFile({ fileName, fileBuffer, organizationId: org.id });
  console.log(`Upload created: ID=${upload.id}, file_type=${upload.file_type}`);

  console.log("Starting import...");
  const result = await startImport(upload.id);
  console.log("Import result:");
  console.log(JSON.stringify(result, null, 2));

  const aggResponse = await fetch(`${API_BASE}/aggregates/?organization=${org.id}&page_size=1`, {
    headers: authHeaders(),
  });
  const aggData = await aggResponse.json().catch(() => ({}));
  if (aggResponse.ok) {
    console.log(`Aggregates total for ${org.name}: ${aggData.count ?? "unknown"}`);
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
