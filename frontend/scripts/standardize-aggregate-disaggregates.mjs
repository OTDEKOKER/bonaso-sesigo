import fs from "node:fs";
import path from "node:path";

const API_BASE = (process.env.BONASO_API_BASE || "https://sesigo.org.bw/api").replace(/\/$/, "");
const TOKEN = process.env.BONASO_ACCESS_TOKEN || "";
const PROJECT_ID = process.env.STD_PROJECT_ID || "2";
const PERIOD_START = process.env.STD_PERIOD_START || "2026-01-01";
const PERIOD_END = process.env.STD_PERIOD_END || "2026-03-31";
const REPORT_PATH = path.join(process.cwd(), "indicator-disaggregation-final-report.json");

if (!TOKEN) {
  console.error("Missing BONASO_ACCESS_TOKEN env var.");
  process.exit(1);
}

if (!fs.existsSync(REPORT_PATH)) {
  console.error(`Missing report file: ${REPORT_PATH}`);
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
  "AYP (10-24)",
];

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

const patchAggregate = async (id, body) => {
  const response = await fetch(`${API_BASE}/aggregates/${id}/`, {
    method: "PATCH",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PATCH /aggregates/${id} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const emptySexMap = () => ({ Male: {}, Female: {} });

const readBandValue = (sexMap, band) => toNumber(sexMap?.[band]);

const normalizeSexBuckets = (source) => {
  const male = source?.Male || source?.male || {};
  const female = source?.Female || source?.female || {};
  return { Male: male, Female: female };
};

const buildProfileMap = (reportIndicators) => {
  const byCanonical = new Map();

  for (const item of reportIndicators) {
    const profile = item?.recommendation?.profile || "kp_age_sex_matrix";
    const disaggregation = item?.disaggregation || {};
    const keyPops = Array.isArray(disaggregation.keyPopOrTargetGroup)
      ? disaggregation.keyPopOrTargetGroup.map((v) => String(v).trim()).filter(Boolean)
      : [];

    const key = canonicalIndicatorKey(item?.indicatorName || "");
    if (!key) continue;
    if (!byCanonical.has(key)) {
      byCanonical.set(key, {
        profile,
        keyPops,
      });
    }
  }

  return byCanonical;
};

const resolveProfile = (indicatorName, profileMap) => {
  const raw = String(indicatorName || "").trim();
  const candidates = [
    canonicalIndicatorKey(raw),
    canonicalIndicatorKey(`Number of ${raw}`),
  ];

  if (/^number\s+of\s+/i.test(raw)) {
    candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+/i, "")));
  }

  if (/^number\s+of\s+number\s+of\s+/i.test(raw)) {
    candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+/i, "")));
    candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+number\s+of\s+/i, "number of ")));
  }

  if (/^number\s+of\s+total\s+number\s+of\s+/i.test(raw)) {
    candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+/i, "")));
    candidates.push(canonicalIndicatorKey(raw.replace(/^number\s+of\s+total\s+number\s+of\s+/i, "total number of ")));
  }

  if (/^number of\s+number of\s+/i.test(raw)) {
    candidates.push(canonicalIndicatorKey(raw.replace(/^number of\s+/i, "")));
  }

  for (const key of candidates) {
    if (profileMap.has(key)) return profileMap.get(key);
  }
  return null;
};

const sumSex = (disaggregates, sex) => {
  let sum = 0;
  for (const kpData of Object.values(disaggregates || {})) {
    const bucket = normalizeSexBuckets(kpData)[sex];
    for (const band of AGE_BANDS) {
      sum += readBandValue(bucket, band);
    }
  }
  return sum;
};

const normalizeKpAlias = (name) => {
  const key = normalize(name);
  if (key === "pwids") return "PWID";
  if (key === "lgbtqia") return "LGBTQI+";
  return String(name || "").trim();
};

const KNOWN_KP_KEYS = new Set([
  "msm",
  "fsw",
  "pwd",
  "pwid",
  "pwids",
  "lgbtqi",
  "lgbtqi+",
  "general pop",
]);

const inferFallbackProfile = (value) => {
  const dis = value?.disaggregates;
  if (dis && typeof dis === "object" && Object.keys(dis).length > 0) {
    const keys = Object.keys(dis);
    const hasKnownKp = keys.some((kp) => KNOWN_KP_KEYS.has(normalize(kp)));
    if (hasKnownKp) {
      return {
        profile: "kp_age_sex_matrix",
        keyPops: keys.map((kp) => normalizeKpAlias(kp)),
      };
    }
    return {
      profile: "age_sex_matrix_non_kp",
      keyPops: [],
    };
  }

  return {
    profile: "single_total",
    keyPops: [],
  };
};

const normalizeAggregateValueByProfile = (value, profileMeta) => {
  const current = value && typeof value === "object" ? { ...value } : {};
  const profile = profileMeta?.profile || "kp_age_sex_matrix";
  const existingDisaggregates = current.disaggregates && typeof current.disaggregates === "object"
    ? current.disaggregates
    : null;

  if (profile === "single_total" || profile === "category_or_cadre_breakdown") {
    const male = toNumber(current.male);
    const female = toNumber(current.female);
    const total = current.total !== undefined ? toNumber(current.total) : male + female;
    return { male, female, total };
  }

  if (!existingDisaggregates) {
    return current;
  }

  if (profile === "age_sex_matrix_non_kp") {
    const collapsed = { "GENERAL POP.": emptySexMap() };

    for (const kpData of Object.values(existingDisaggregates)) {
      const normalized = normalizeSexBuckets(kpData);
      for (const sex of ["Male", "Female"]) {
        for (const band of AGE_BANDS) {
          const val = readBandValue(normalized[sex], band);
          collapsed["GENERAL POP."][sex][band] = toNumber(collapsed["GENERAL POP."][sex][band]) + val;
        }
      }
    }

    const male = sumSex(collapsed, "Male");
    const female = sumSex(collapsed, "Female");
    const total = male + female;
    return { ...current, male, female, total, disaggregates: collapsed };
  }

  const allowedKpRaw = Array.isArray(profileMeta?.keyPops) ? profileMeta.keyPops : [];
  const allowed = allowedKpRaw.length > 0
    ? new Set(allowedKpRaw.map((v) => normalizeKpAlias(v)))
    : null;

  const normalizedOutput = {};

  for (const [rawKp, kpData] of Object.entries(existingDisaggregates)) {
    const kp = normalizeKpAlias(rawKp);
    if (allowed && !allowed.has(kp)) continue;

    const normalized = normalizeSexBuckets(kpData);
    if (!normalizedOutput[kp]) normalizedOutput[kp] = emptySexMap();

    for (const sex of ["Male", "Female"]) {
      for (const band of AGE_BANDS) {
        const val = readBandValue(normalized[sex], band);
        if (val !== 0) normalizedOutput[kp][sex][band] = val;
      }
    }
  }

  const male = sumSex(normalizedOutput, "Male");
  const female = sumSex(normalizedOutput, "Female");
  const fallbackMale = toNumber(current.male);
  const fallbackFemale = toNumber(current.female);

  const finalMale = male === 0 && fallbackMale > 0 ? fallbackMale : male;
  const finalFemale = female === 0 && fallbackFemale > 0 ? fallbackFemale : female;
  const total = finalMale + finalFemale;

  return { ...current, male: finalMale, female: finalFemale, total, disaggregates: normalizedOutput };
};

const main = async () => {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  const profileMap = buildProfileMap(Array.isArray(report?.indicators) ? report.indicators : []);

  const indicators = await listAll("/indicators/");
  const indicatorNameById = new Map(indicators.map((i) => [Number(i.id), String(i.name || "")]));

  const filters = new URLSearchParams({
    project: String(PROJECT_ID),
    period_start: PERIOD_START,
    period_end: PERIOD_END,
  });
  const aggregates = await listAll(`/aggregates/?${filters.toString()}`);

  let patched = 0;
  let unchanged = 0;
  let unmatchedProfile = 0;
  let fallbackProfileUsed = 0;
  let failed = 0;

  for (const agg of aggregates) {
    try {
      const id = Number(agg.id);
      const indicatorId = Number(agg.indicator);
      const indicatorName = agg.indicator_name || indicatorNameById.get(indicatorId) || "";
      let profileMeta = resolveProfile(indicatorName, profileMap);
      if (!profileMeta) {
        unmatchedProfile += 1;
        profileMeta = inferFallbackProfile(agg.value);
        fallbackProfileUsed += 1;
      }

      const currentValue = agg.value && typeof agg.value === "object" ? agg.value : {};
      const nextValue = normalizeAggregateValueByProfile(currentValue, profileMeta);

      if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) {
        unchanged += 1;
        continue;
      }

      await patchAggregate(id, { value: nextValue });
      patched += 1;
    } catch (error) {
      failed += 1;
      console.error(`ERR aggregate ${agg?.id}: ${String(error?.message || error)}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    scope: {
      project: PROJECT_ID,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
    },
    totalAggregates: aggregates.length,
    patched,
    unchanged,
    unmatchedProfile,
    fallbackProfileUsed,
    failed,
  };

  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const outFile = path.join(reportsDir, "aggregate-disaggregate-standardization-summary.json");
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log("=== STANDARDIZATION SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved: ${outFile}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
