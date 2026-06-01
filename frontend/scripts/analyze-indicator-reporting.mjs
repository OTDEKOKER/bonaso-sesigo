import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx-js-style";

const zipPath = "C:/Users/dekok/Downloads/CSOs Reports (2).zip";

const normalizeHeader = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseCSV = (text) => {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const row = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
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
};

const profile = new Map();

const getOrCreateIndicator = (key, seed = {}) => {
  if (!profile.has(key)) {
    profile.set(key, {
      indicatorId: seed.indicatorId || "",
      indicatorName: seed.indicatorName || "",
      occurrences: 0,
      rows: 0,
      files: new Set(),
      organizations: new Set(),
      projects: new Set(),
      periods: new Set(),
      hasValueJson: false,
      hasKPRowFields: false,
      hasAgeSexRowFields: false,
      valueJsonKp: new Set(),
      valueJsonAgeBands: new Set(),
      extraDisaggregateColumns: new Set(),
      genericDisaggregatePairs: new Set(),
    });
  }
  return profile.get(key);
};

const parseRows = (rows, fileLabel, sheetName) => {
  if (!Array.isArray(rows) || rows.length < 2) return;
  const headerRaw = rows[0].map((cell) => String(cell ?? "").trim());
  const header = headerRaw.map(normalizeHeader);

  const idx = (name) => header.indexOf(normalizeHeader(name));
  const get = (row, name) => {
    const i = idx(name);
    if (i < 0) return "";
    return String(row[i] ?? "").trim();
  };

  const fixedColumns = new Set([
    "indicator_id",
    "indicator_name",
    "project_id",
    "project_name",
    "organization_id",
    "organization_name",
    "period_start",
    "period_end",
    "value_json",
    "male",
    "female",
    "total",
    "notes",
    "key_population",
    "key_population_name",
    "age_range",
    "age_band",
    "sex",
    "disaggregate_type",
    "disaggregate_value",
    "value",
    "amount",
    "count",
  ]);

  for (const row of rows.slice(1)) {
    const nonEmpty = row.some((cell) => String(cell ?? "").trim() !== "");
    if (!nonEmpty) continue;

    const indicatorId = get(row, "indicator_id");
    const indicatorName = get(row, "indicator_name");
    const key = indicatorId || indicatorName;
    if (!key) continue;

    const item = getOrCreateIndicator(key, { indicatorId, indicatorName });
    item.occurrences += 1;
    item.rows += 1;
    item.files.add(`${fileLabel} :: ${sheetName}`);

    const org = get(row, "organization_name") || get(row, "organization_id");
    const project = get(row, "project_name") || get(row, "project_id");
    const periodStart = get(row, "period_start");
    const periodEnd = get(row, "period_end");
    if (org) item.organizations.add(org);
    if (project) item.projects.add(project);
    if (periodStart || periodEnd) item.periods.add(`${periodStart}..${periodEnd}`);

    const kp = get(row, "key_population") || get(row, "key_population_name");
    const age = get(row, "age_range") || get(row, "age_band");
    const sex = get(row, "sex");
    if (kp) item.hasKPRowFields = true;
    if (age || sex) item.hasAgeSexRowFields = true;

    const disType = get(row, "disaggregate_type");
    const disValue = get(row, "disaggregate_value");
    if (disType || disValue) {
      item.genericDisaggregatePairs.add(`${disType}:${disValue}`);
    }

    const valueJson = get(row, "value_json");
    if (valueJson) {
      item.hasValueJson = true;
      try {
        const parsed = JSON.parse(valueJson);
        const disaggregates = parsed?.disaggregates;
        if (disaggregates && typeof disaggregates === "object") {
          for (const kpKey of Object.keys(disaggregates)) {
            item.valueJsonKp.add(kpKey);
            const kpData = disaggregates[kpKey] || {};
            for (const sexKey of ["Male", "Female"]) {
              const byBand = kpData?.[sexKey] || {};
              for (const band of Object.keys(byBand)) {
                item.valueJsonAgeBands.add(band);
              }
            }
          }
        }
      } catch {
        // ignore malformed JSON
      }
    }

    header.forEach((columnKey) => {
      if (fixedColumns.has(columnKey)) return;
      item.extraDisaggregateColumns.add(columnKey);
    });
  }
};

const processWorkbookBuffer = (buffer, fileLabel) => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    parseRows(rows, fileLabel, sheetName);
  }
};

const processCsvBuffer = (buffer, fileLabel) => {
  const text = buffer.toString("utf8");
  const rows = parseCSV(text);
  parseRows(rows, fileLabel, "CSV");
};

const processZipBuffer = async (buffer, sourceLabel) => {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.dir) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const fullLabel = `${sourceLabel}/${entry.name}`;
    const content = Buffer.from(await entry.async("uint8array"));
    if ([".xlsx", ".xls", ".xlsm"].includes(ext)) {
      processWorkbookBuffer(content, fullLabel);
    } else if (ext === ".csv") {
      processCsvBuffer(content, fullLabel);
    } else if (ext === ".zip") {
      await processZipBuffer(content, fullLabel);
    }
  }
};

const main = async () => {
  if (!fs.existsSync(zipPath)) {
    console.error(`ZIP not found: ${zipPath}`);
    process.exit(1);
  }

  const rootBuffer = fs.readFileSync(zipPath);
  await processZipBuffer(rootBuffer, "CSOs Reports (2).zip");

  const output = Array.from(profile.values())
    .map((item) => ({
      indicatorId: item.indicatorId,
      indicatorName: item.indicatorName,
      rows: item.rows,
      filesCount: item.files.size,
      organizations: Array.from(item.organizations).sort(),
      projects: Array.from(item.projects).sort(),
      periods: Array.from(item.periods).sort(),
      reportingShape: {
        hasValueJson: item.hasValueJson,
        hasKPRowFields: item.hasKPRowFields,
        hasAgeSexRowFields: item.hasAgeSexRowFields,
        valueJsonKeyPopulations: Array.from(item.valueJsonKp).sort(),
        valueJsonAgeBands: Array.from(item.valueJsonAgeBands).sort(),
        extraDisaggregateColumns: Array.from(item.extraDisaggregateColumns).sort(),
        genericDisaggregatePairs: Array.from(item.genericDisaggregatePairs).sort(),
      },
      sampleSources: Array.from(item.files).slice(0, 8),
    }))
    .sort((a, b) => {
      const ak = `${a.indicatorId || ""} ${a.indicatorName || ""}`.trim().toLowerCase();
      const bk = `${b.indicatorId || ""} ${b.indicatorName || ""}`.trim().toLowerCase();
      return ak.localeCompare(bk);
    });

  const result = {
    generatedAt: new Date().toISOString(),
    indicatorsFound: output.length,
    indicators: output,
  };

  const outPath = path.resolve("indicator-reporting-profile.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`WROTE: ${outPath}`);
  console.log(`INDICATORS_FOUND: ${output.length}`);
};

await main();
