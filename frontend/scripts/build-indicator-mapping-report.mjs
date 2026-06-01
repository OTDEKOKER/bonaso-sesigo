import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve("indicator-disaggregation-study.json");

const isNoiseIndicator = (indicator) => {
  const name = String(indicator.indicatorName || "").trim();
  const organizations = indicator.organizations || [];

  if (!name) return true;
  if (/^Client\s+[A-Z0-9]+$/i.test(name)) return true;
  if (/^Name\s*\(Optional\s*\/\s*Code\)/i.test(name)) return true;
  if (organizations.some((org) => String(org).toLowerCase().includes("counselling session capturing"))) {
    return true;
  }

  return false;
};

const recommendationFor = (indicator) => {
  const shape = new Set(indicator.reportingShape || []);
  const dis = indicator.disaggregation || {};
  const ageCount = (dis.ageBands || []).length;
  const sexCount = (dis.sex || []).length;
  const kpCount = (dis.keyPopOrTargetGroup || []).length;
  const roleCount = (dis.roleOrCadre || []).length;
  const otherCount = (dis.otherBreakdowns || []).length;

  const notes = [];
  if (shape.has("matrix-age-sex")) notes.push("Matrix reporting detected");
  if (shape.has("single-value")) notes.push("Single-value reporting detected");

  let profile = "single_total";

  if (shape.has("matrix-age-sex") && kpCount > 0) {
    profile = "kp_age_sex_matrix";
    notes.push("Use key population + age + sex disaggregates");
  } else if (shape.has("matrix-age-sex") && ageCount > 0) {
    profile = "age_sex_matrix_non_kp";
    notes.push("Use age + sex matrix without requiring key population");
  } else if (roleCount > 0) {
    profile = "category_or_cadre_breakdown";
    notes.push("Use role/cadre category totals");
  } else if (otherCount > 0) {
    profile = "generic_other_disaggregates";
    notes.push("Capture generic disaggregates in other_disaggregates");
  }

  return {
    profile,
    notes,
    dimensions: {
      ageBands: ageCount,
      sexValues: sexCount,
      keyPopOrTargetGroup: kpCount,
      roleOrCadre: roleCount,
      otherBreakdowns: otherCount,
    },
  };
};

const main = () => {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source file: ${sourcePath}`);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const indicators = Array.isArray(source.indicators) ? source.indicators : [];

  const cleaned = indicators
    .filter((indicator) => !isNoiseIndicator(indicator))
    .map((indicator) => {
      const recommendation = recommendationFor(indicator);
      return {
        indicatorName: indicator.indicatorName,
        codeSamples: indicator.codeSamples || [],
        reportingShape: indicator.reportingShape || [],
        disaggregation: indicator.disaggregation || {
          ageBands: [],
          sex: [],
          keyPopOrTargetGroup: [],
          roleOrCadre: [],
          otherBreakdowns: [],
        },
        organizations: indicator.organizations || [],
        recommendation,
      };
    })
    .sort((a, b) => String(a.indicatorName).localeCompare(String(b.indicatorName)));

  const profileCounts = cleaned.reduce((acc, item) => {
    const key = item.recommendation.profile;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const reportJson = {
    generatedAt: new Date().toISOString(),
    sourceIndicators: indicators.length,
    cleanedIndicators: cleaned.length,
    profileCounts,
    indicators: cleaned,
  };

  const jsonPath = path.resolve("indicator-disaggregation-final-report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), "utf8");

  const lines = [];
  lines.push("# Indicator Reporting & Disaggregation Final Report");
  lines.push("");
  lines.push(`Generated: ${reportJson.generatedAt}`);
  lines.push(`Source indicators: ${reportJson.sourceIndicators}`);
  lines.push(`Cleaned indicators: ${reportJson.cleanedIndicators}`);
  lines.push("");
  lines.push("## Profile Counts");
  Object.entries(profileCounts)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .forEach(([profile, count]) => {
      lines.push(`- ${profile}: ${count}`);
    });
  lines.push("");
  lines.push("## Per-Indicator Mapping Recommendations");
  lines.push("");

  for (const indicator of cleaned) {
    lines.push(`### ${indicator.indicatorName}`);
    lines.push(`- Recommended profile: ${indicator.recommendation.profile}`);
    lines.push(`- Reporting shape: ${(indicator.reportingShape || []).join(", ") || "n/a"}`);
    lines.push(`- Code samples: ${(indicator.codeSamples || []).join(", ") || "n/a"}`);
    lines.push(`- Disaggregate dimensions: age=${indicator.recommendation.dimensions.ageBands}, sex=${indicator.recommendation.dimensions.sexValues}, kp/target=${indicator.recommendation.dimensions.keyPopOrTargetGroup}, role/cadre=${indicator.recommendation.dimensions.roleOrCadre}, other=${indicator.recommendation.dimensions.otherBreakdowns}`);

    const dis = indicator.disaggregation || {};
    const age = (dis.ageBands || []).slice(0, 20);
    const sex = (dis.sex || []).slice(0, 10);
    const kp = (dis.keyPopOrTargetGroup || []).slice(0, 20);
    const role = (dis.roleOrCadre || []).slice(0, 20);
    const other = (dis.otherBreakdowns || []).slice(0, 20);

    lines.push(`- Age bands: ${age.join(" | ") || "n/a"}`);
    lines.push(`- Sex values: ${sex.join(" | ") || "n/a"}`);
    lines.push(`- KP/target groups: ${kp.join(" | ") || "n/a"}`);
    lines.push(`- Role/cadre: ${role.join(" | ") || "n/a"}`);
    lines.push(`- Other breakdowns: ${other.join(" | ") || "n/a"}`);
    lines.push(`- Organizations seen: ${(indicator.organizations || []).slice(0, 12).join(" | ") || "n/a"}`);

    if (indicator.recommendation.notes.length) {
      lines.push(`- Notes: ${indicator.recommendation.notes.join("; ")}`);
    }

    lines.push("");
  }

  const mdPath = path.resolve("indicator-disaggregation-final-report.md");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

  console.log(`WROTE_JSON: ${jsonPath}`);
  console.log(`WROTE_MD: ${mdPath}`);
  console.log(`CLEANED_INDICATORS: ${cleaned.length}`);
};

main();
