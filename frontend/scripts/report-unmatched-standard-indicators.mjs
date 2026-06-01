import fs from "node:fs";

const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const PROJECT_ID = process.env.STD_PROJECT_ID || "2";
const PERIOD_START = process.env.STD_PERIOD_START || "2026-01-01";
const PERIOD_END = process.env.STD_PERIOD_END || "2026-03-31";

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
    .replace(/\bno\.?\b/g, "number")
    .trim();

const authHeaders = () => ({ Authorization: `Bearer ${TOKEN}` });

const apiGetJson = async (url) => {
  const response = await fetch(url, { headers: authHeaders() });
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

const buildProfileMap = (reportIndicators) => {
  const map = new Map();
  for (const item of reportIndicators || []) {
    const key = canonicalIndicatorKey(item?.indicatorName || "");
    if (key && !map.has(key)) map.set(key, item?.recommendation?.profile || "kp_age_sex_matrix");
  }
  return map;
};

const resolveProfile = (name, profileMap) => {
  const raw = String(name || "").trim();
  const candidates = [
    canonicalIndicatorKey(raw),
    canonicalIndicatorKey(`Number of ${raw}`),
  ];
  if (/^number\s+of\s+/i.test(raw)) candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+/i, "")));
  if (/^number\s+of\s+number\s+of\s+/i.test(raw)) candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+number\s+of\s+/i, "number of ")));
  if (/^number\s+of\s+total\s+number\s+of\s+/i.test(raw)) candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+total\s+number\s+of\s+/i, "total number of ")));

  for (const key of candidates) {
    if (profileMap.has(key)) return profileMap.get(key);
  }
  return null;
};

const main = async () => {
  const report = JSON.parse(fs.readFileSync("indicator-disaggregation-final-report.json", "utf8"));
  const profileMap = buildProfileMap(report?.indicators || []);

  const filters = new URLSearchParams({
    project: String(PROJECT_ID),
    period_start: PERIOD_START,
    period_end: PERIOD_END,
  });
  const aggregates = await listAll(`/aggregates/?${filters.toString()}`);

  const unmatched = new Map();
  for (const agg of aggregates) {
    const name = String(agg.indicator_name || "").trim() || `indicator:${agg.indicator}`;
    if (!resolveProfile(name, profileMap)) {
      unmatched.set(name, (unmatched.get(name) || 0) + 1);
    }
  }

  const rows = Array.from(unmatched.entries())
    .map(([indicator_name, count]) => ({ indicator_name, count }))
    .sort((a, b) => b.count - a.count || a.indicator_name.localeCompare(b.indicator_name));

  const outPath = "reports/aggregate-standard-unmatched-indicators.json";
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`Unmatched indicators: ${rows.length}`);
  console.log(`Saved: ${outPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
