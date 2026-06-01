import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx-js-style";

const zipPath = "C:/Users/dekok/Downloads/CSOs Reports (2).zip";

const skipSheet = (name) => {
  const normalized = String(name || "").trim().toLowerCase();
  return [
    "indicator matrix",
    "drop down",
    "indicators",
    "narrative template",
    "totals",
  ].some((token) => normalized.includes(token));
};

const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const startsLikeIndicatorCode = (value) => /^\d+[a-z]?$/i.test(String(value || "").trim());

const profiles = new Map();

const getProfile = (name) => {
  const key = normalizeKey(name).toLowerCase();
  if (!profiles.has(key)) {
    profiles.set(key, {
      indicatorName: normalizeKey(name),
      files: new Set(),
      sheets: new Set(),
      organizations: new Set(),
      codeSamples: new Set(),
      disaggregation: {
        ageBands: new Set(),
        sex: new Set(),
        keyPopOrTargetGroup: new Set(),
        roleOrCadre: new Set(),
        otherBreakdowns: new Set(),
      },
      reportingShape: new Set(),
      sampleRows: new Set(),
    });
  }
  return profiles.get(key);
};

const processSheet = (rows, sheetName, sourceFile) => {
  if (!Array.isArray(rows) || rows.length === 0) return;

  let currentIndicator = null;
  let currentAgeBands = [];

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r].map((v) => normalizeKey(v));
    const [colA, colB, , colD, colE, ...rest] = row;

    const hasAgeSexHeader = String(colE || "").toLowerCase() === "age/sex";
    if (hasAgeSexHeader) {
      currentAgeBands = rest.filter(Boolean);
      continue;
    }

    if (startsLikeIndicatorCode(colA) && colB) {
      currentIndicator = getProfile(colB);
      currentIndicator.codeSamples.add(colA);
      currentIndicator.files.add(sourceFile);
      currentIndicator.sheets.add(sheetName);
      currentIndicator.reportingShape.add(currentAgeBands.length ? "matrix-age-sex" : "single-value");
      if (sheetName) currentIndicator.organizations.add(sheetName);
      continue;
    }

    if (!currentIndicator) continue;

    const nonEmpty = row.some(Boolean);
    if (!nonEmpty) continue;

    const rowSex = /^(male|female|m|f)$/i.test(colE || "") ? colE : "";
    if (rowSex) currentIndicator.disaggregation.sex.add(colE);

    if (currentAgeBands.length) {
      currentAgeBands.forEach((band) => currentIndicator.disaggregation.ageBands.add(band));
    }

    if (colD && !rowSex) {
      const label = colD.toLowerCase();
      if (/(msm|fsw|pwd|pwid|lgbt|general pop|agyw|abym|plhiv|target|population|survivor|young)/i.test(label)) {
        currentIndicator.disaggregation.keyPopOrTargetGroup.add(colD);
      } else if (/(mobilizer|officer|stakeholder|program|m&e|provider|cadre)/i.test(label)) {
        currentIndicator.disaggregation.roleOrCadre.add(colD);
      } else {
        currentIndicator.disaggregation.otherBreakdowns.add(colD);
      }
    }

    if (colD && rowSex) {
      currentIndicator.disaggregation.keyPopOrTargetGroup.add(colD);
    }

    const rowSnippet = [colD, colE, ...rest.slice(0, 4)].filter(Boolean).join(" | ");
    if (rowSnippet) {
      currentIndicator.sampleRows.add(rowSnippet);
    }
  }
};

const processWorkbookBuffer = (buffer, sourceFile) => {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return;
  }

  for (const sheetName of wb.SheetNames || []) {
    if (skipSheet(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    processSheet(rows, sheetName, sourceFile);
  }
};

const processZipBuffer = async (buffer, sourceLabel) => {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.dir) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const full = `${sourceLabel}/${entry.name}`;
    const content = Buffer.from(await entry.async("uint8array"));

    if ([".xlsx", ".xls", ".xlsm"].includes(ext)) {
      processWorkbookBuffer(content, full);
    } else if (ext === ".zip") {
      await processZipBuffer(content, full);
    }
  }
};

const main = async () => {
  if (!fs.existsSync(zipPath)) {
    console.error(`ZIP not found: ${zipPath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(zipPath);
  await processZipBuffer(buffer, "CSOs Reports (2).zip");

  const indicators = Array.from(profiles.values())
    .map((item) => ({
      indicatorName: item.indicatorName,
      codeSamples: Array.from(item.codeSamples),
      filesCount: item.files.size,
      sheetsCount: item.sheets.size,
      organizations: Array.from(item.organizations).sort(),
      reportingShape: Array.from(item.reportingShape).sort(),
      disaggregation: {
        ageBands: Array.from(item.disaggregation.ageBands).sort(),
        sex: Array.from(item.disaggregation.sex).sort(),
        keyPopOrTargetGroup: Array.from(item.disaggregation.keyPopOrTargetGroup).sort(),
        roleOrCadre: Array.from(item.disaggregation.roleOrCadre).sort(),
        otherBreakdowns: Array.from(item.disaggregation.otherBreakdowns).sort(),
      },
      sampleRows: Array.from(item.sampleRows).slice(0, 12),
      sampleSources: Array.from(item.files).slice(0, 6),
    }))
    .sort((a, b) => a.indicatorName.localeCompare(b.indicatorName));

  const result = {
    generatedAt: new Date().toISOString(),
    indicatorsFound: indicators.length,
    indicators,
  };

  const outPath = path.resolve("indicator-disaggregation-study.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`WROTE: ${outPath}`);
  console.log(`INDICATORS_FOUND: ${indicators.length}`);
};

await main();
