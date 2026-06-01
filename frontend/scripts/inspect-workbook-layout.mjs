import XLSX from "xlsx-js-style";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/inspect-workbook-layout.mjs <xlsx-path>");
  process.exit(1);
}

const workbook = XLSX.readFile(sourcePath);
console.log("SHEETS=", workbook.SheetNames.join(" | "));

for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  console.log(`\n--- SHEET: ${sheetName} (rows=${rows.length}) ---`);
  for (let i = 0; i < Math.min(rows.length, 80); i += 1) {
    const row = rows[i] || [];
    const nonEmpty = row
      .map((v, idx) => ({ idx, v: String(v ?? "").trim() }))
      .filter((item) => item.v !== "");
    if (nonEmpty.length === 0) continue;
    const preview = nonEmpty
      .slice(0, 12)
      .map((item) => `${item.idx}:${item.v}`)
      .join(" || ");
    console.log(`${i}: ${preview}`);
  }
}
