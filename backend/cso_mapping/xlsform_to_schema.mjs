// Convert the KoboToolbox XLSForm for the CSO Mapping assessment into a compact
// JSON schema used by both the Django backend (validation + export headers) and
// the Next.js frontend (rendering). The source form is simple: text/note/
// select_one fields, single-level groups, and only `${field} = 'value'`
// relevance/constraint expressions — so a tailored converter is enough.
//
// Regenerate after editing the XLSForm:
//   node backend/cso_mapping/xlsform_to_schema.mjs <form.xlsx> backend/cso_mapping/form_schema.json
// (xlsx-js-style is resolved from the sibling frontend/node_modules.)
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendModules = path.resolve(here, "../../frontend/package.json");
const require = createRequire(frontendModules);
const XLSX = require("xlsx-js-style");

const SRC = process.argv[2];
const OUT = process.argv[3];
const wb = XLSX.readFile(SRC);
const survey = XLSX.utils.sheet_to_json(wb.Sheets["survey"], { defval: "" });
const choicesRows = XLSX.utils.sheet_to_json(wb.Sheets["choices"], { defval: "" });
const settings = XLSX.utils.sheet_to_json(wb.Sheets["settings"], { defval: "" })[0] || {};

const LABEL = "label::English (en)";
const HINT = "hint::English (en)";
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// choices grouped by list_name
const choices = {};
for (const r of choicesRows) {
  const list = clean(r.list_name);
  if (!list) continue;
  (choices[list] ||= []).push({ name: clean(r.name), label: clean(r[LABEL]) });
}

// Parse `${field} = 'value'` -> { field, op:'eq', value }. `. = 'value'` (a
// constraint on the field itself) -> { field:'.', op:'eq', value }.
function parseCond(expr) {
  const e = clean(expr);
  if (!e) return null;
  const m = e.match(/^\$\{([a-z0-9_]+)\}\s*=\s*'([^']*)'$/i) || e.match(/^(\.)\s*=\s*'([^']*)'$/);
  if (!m) return { raw: e }; // keep raw for anything unexpected (none expected here)
  return { field: m[1], op: "eq", value: m[2] };
}

function fieldType(rawType) {
  const t = clean(rawType);
  if (t.startsWith("select_one ")) return { type: "select_one", list: t.split(/\s+/)[1] };
  if (t.startsWith("select_multiple ")) return { type: "select_multiple", list: t.split(/\s+/)[1] };
  return { type: t };
}

const META = new Set(["start", "end", "today", "deviceid", "audit"]);
const sections = [];
let current = null; // active group section

function pushField(f) {
  if (current) current.fields.push(f);
  else sections.push({ name: `__${f.name}`, label: null, relevant: null, fields: [f] });
}

for (const row of survey) {
  const rawType = clean(row.type);
  const name = clean(row.name);
  if (!rawType) continue;

  if (rawType === "begin_group") {
    current = {
      name,
      label: clean(row[LABEL]) || null,
      relevant: parseCond(row.relevant),
      appearance: clean(row.appearance) || null,
      fields: [],
    };
    sections.push(current);
    continue;
  }
  if (rawType === "end_group") {
    current = null;
    continue;
  }
  if (META.has(rawType)) continue; // drop auto metadata

  const { type, list } = fieldType(rawType);
  const field = {
    name,
    type, // text | note | select_one | select_multiple | integer | ...
    label: clean(row[LABEL]),
    hint: clean(row[HINT]) || null,
    required: clean(row.required).toLowerCase() === "true",
    multiline: clean(row.appearance).includes("multiline"),
    relevant: parseCond(row.relevant),
    constraint: parseCond(row.constraint),
  };
  if (list) {
    field.list = list;
    field.choices = choices[list] || [];
  }
  pushField(field);
}

const schema = {
  id_string: clean(settings.id_string) || "bonaso_cso_mapping",
  version: clean(settings.version) || "1",
  title: "Botswana Health Service CSO Mapping and Capacity Assessment",
  default_language: clean(settings.default_language) || "English (en)",
  sections,
  choices,
};

fs.writeFileSync(OUT, JSON.stringify(schema, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`sections=${sections.length}, choices lists=${Object.keys(choices).join(",")}`);
const totalFields = sections.reduce((n, s) => n + s.fields.length, 0);
console.log(`total fields=${totalFields}`);
console.log("section names:", sections.map((s) => `${s.name}${s.relevant ? "[rel]" : ""}`).join(", "));
