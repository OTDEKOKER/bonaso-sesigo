import process from "node:process";

const API_BASE = (
  process.env.BONASO_API_BASE ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.BACKEND_API_URL ||
  "https://sesigo.org.bw/api"
).replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const PAGE_SIZE = Math.max(1, Number(process.env.BONASO_PAGE_SIZE || 500));

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run");

const typesArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--types="));
const requestedTypes = new Set(
  (typesArg ? typesArg.split("=")[1] : "aggregates,reports,scheduled")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

const apiBaseUrl = new URL(`${API_BASE}/`);

function asAbsoluteUrl(input) {
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("/")) {
    return new URL(input, apiBaseUrl.origin).toString();
  }
  return new URL(input, apiBaseUrl).toString();
}

function authHeaders(json = true) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(false),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${body}`.trim());
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  return response.json();
}

async function listAll(endpoint) {
  const items = [];
  let nextUrl = `${API_BASE}${endpoint}${endpoint.includes("?") ? "&" : "?"}page_size=${PAGE_SIZE}`;

  while (nextUrl) {
    const data = await requestJson(nextUrl);

    if (Array.isArray(data)) {
      items.push(...data);
      break;
    }

    if (Array.isArray(data?.results)) {
      items.push(...data.results);
      nextUrl = asAbsoluteUrl(data.next);
      continue;
    }

    break;
  }

  return items;
}

async function deleteMany(label, endpointPrefix, ids) {
  let deleted = 0;

  for (const id of ids) {
    const endpoint = `${API_BASE}${endpointPrefix}${id}/`;
    if (dryRun) {
      deleted += 1;
      continue;
    }

    await requestJson(endpoint, {
      method: "DELETE",
      headers: authHeaders(false),
    });
    deleted += 1;
  }

  console.log(`${label}: ${dryRun ? "would delete" : "deleted"} ${deleted}`);
  return deleted;
}

async function purgeAggregates() {
  const rows = await listAll("/aggregates/");
  const ids = rows
    .map((row) => Number(row?.id))
    .filter((id) => Number.isFinite(id));
  console.log(`Aggregates found: ${ids.length}`);
  return deleteMany("Aggregates", "/aggregates/", ids);
}

async function purgeReports() {
  const rows = await listAll("/analysis/reports/");
  const ids = rows
    .map((row) => Number(row?.id))
    .filter((id) => Number.isFinite(id));
  console.log(`Reports found: ${ids.length}`);
  return deleteMany("Reports", "/analysis/reports/", ids);
}

async function purgeScheduledReports() {
  const rows = await listAll("/analysis/scheduled-reports/");
  const ids = rows
    .map((row) => Number(row?.id))
    .filter((id) => Number.isFinite(id));
  console.log(`Scheduled reports found: ${ids.length}`);
  return deleteMany("Scheduled reports", "/analysis/scheduled-reports/", ids);
}

async function main() {
  const startedAt = Date.now();
  const summary = {
    aggregates: 0,
    reports: 0,
    scheduled: 0,
  };

  console.log(`API base: ${API_BASE}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE DELETE"}`);

  if (requestedTypes.has("aggregates")) {
    summary.aggregates = await purgeAggregates();
  }

  if (requestedTypes.has("reports")) {
    summary.reports = await purgeReports();
  }

  if (requestedTypes.has("scheduled")) {
    summary.scheduled = await purgeScheduledReports();
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("\nPurge summary");
  console.log(`- Aggregates: ${summary.aggregates}`);
  console.log(`- Reports: ${summary.reports}`);
  console.log(`- Scheduled reports: ${summary.scheduled}`);
  console.log(`- Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
