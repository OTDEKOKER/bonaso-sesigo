import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx-js-style";

const SOURCE_PATH = process.argv[2] || process.env.SOURCE_PATH || "";

if (!SOURCE_PATH) {
  console.error("Usage: node scripts/extract-workbook-indicators-disaggregates.mjs <path-to-xlsx>");
  process.exit(1);
}

const normalize = (value) =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeHeader = (value) =>
  normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const splitDisaggregates = (value) => {
  const raw = normalize(value);
  if (!raw) return [];
  return raw
    .split(/\||,|;|\/|\\n|\\r/)
    .map((item) => normalize(item))
    .filter(Boolean);
};

const detectHeader = (rows) => {
  let bestIndex = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const header = (rows[i] || []).map((cell) => normalizeHeader(cell));
    if (!header.some(Boolean)) continue;

    const hasIndicator = header.some((h) => ["indicator", "indicator_name", "indicator_definition"].includes(h));
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

const getByAliases = (row, header, aliases) => {
  for (const alias of aliases) {
    const idx = header.indexOf(alias);
    if (idx >= 0) {
      const value = normalize(row[idx]);
      if (value) return value;
    }
  }
  return "";
};

const extractTemplateStyleRows = (rows) => {
  const items = [];
  let current = null;

  for (const row of rows) {
    const col0 = normalize(row?.[0]);
    const col1 = normalize(row?.[1]);
    const col3 = normalize(row?.[3]);

    const hasNumericIndex = col0 !== "" && !Number.isNaN(Number(col0));
    if (hasNumericIndex && col1.length >= 3) {
      current = {
        indicatorName: col1,
        disaggregates: [],
      };
      if (col3 && normalize(col3).toLowerCase() !== "total") {
        current.disaggregates.push(col3);
      }
      items.push(current);
      continue;
    }

    if (current && !col0 && !col1 && col3 && col3.toLowerCase() !== "total") {
      current.disaggregates.push(col3);
    }
  }

  return items;
};

const main = () => {
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error(`Source not found: ${SOURCE_PATH}`);
    process.exit(1);
  }

  const workbookBuffer = fs.readFileSync(SOURCE_PATH);
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const extracted = new Map();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const context = detectHeader(rows);
    if (context) {
      const { header, dataRows } = context;
      for (const row of dataRows) {
        const indicatorName = getByAliases(row, header, ["indicator_name", "indicator", "indicator_definition"]);
        if (!indicatorName || indicatorName.length < 3) continue;

        const disaggregationRaw = [
          getByAliases(row, header, ["disaggregation", "dissagregation", "disaggregate", "disaggregates"]),
          getByAliases(row, header, ["variables", "variable", "variable_description"]),
        ]
          .filter(Boolean)
          .join(" | ");

        if (!extracted.has(indicatorName)) {
          extracted.set(indicatorName, {
            indicatorName,
            sheets: new Set(),
            disaggregates: new Set(),
          });
        }

        const bucket = extracted.get(indicatorName);
        bucket.sheets.add(sheetName);
        splitDisaggregates(disaggregationRaw).forEach((value) => bucket.disaggregates.add(value));
      }
      continue;
    }

    const templateItems = extractTemplateStyleRows(rows);
    for (const item of templateItems) {
      const indicatorName = normalize(item.indicatorName);
      if (!indicatorName || indicatorName.length < 3) continue;

      if (!extracted.has(indicatorName)) {
        extracted.set(indicatorName, {
          indicatorName,
          sheets: new Set(),
          disaggregates: new Set(),
        });
      }

      const bucket = extracted.get(indicatorName);
      bucket.sheets.add(sheetName);
      item.disaggregates.map((value) => normalize(value)).filter(Boolean).forEach((value) => bucket.disaggregates.add(value));
    }
  }

  const indicators = Array.from(extracted.values())
    .map((item) => ({
      indicatorName: item.indicatorName,
      sheets: Array.from(item.sheets).sort(),
      disaggregates: Array.from(item.disaggregates).sort(),
      disaggregateCount: item.disaggregates.size,
    }))
    .sort((a, b) => a.indicatorName.localeCompare(b.indicatorName));

  const reportsDir = path.resolve("reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `makgabaneng-q3-indicators-disaggregates-${stamp}`;
  const jsonPath = path.join(reportsDir, `${baseName}.json`);
  const mdPath = path.join(reportsDir, `${baseName}.md`);

  const payload = {
    sourcePath: SOURCE_PATH,
    extractedAt: new Date().toISOString(),
    totalIndicators: indicators.length,
    indicators,
  };

  const md = [
    `# Makgabaneng Q3 Indicators and Disaggregates`,
    ``,
    `- Source: ${SOURCE_PATH}`,
    `- Extracted at: ${payload.extractedAt}`,
    `- Total indicators: ${indicators.length}`,
    ``,
    ...indicators.flatMap((item, index) => [
      `## ${index + 1}. ${item.indicatorName}`,
      `- Sheets: ${item.sheets.join(", ") || "-"}`,
      `- Disaggregates (${item.disaggregateCount}): ${item.disaggregates.join(", ") || "None"}`,
      ``,
    ]),
  ].join("\n");

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(mdPath, md, "utf8");

  console.log(`SOURCE=${SOURCE_PATH}`);
  console.log(`INDICATORS=${indicators.length}`);
  console.log(`REPORT_JSON=${jsonPath}`);
  console.log(`REPORT_MD=${mdPath}`);
};

main();
