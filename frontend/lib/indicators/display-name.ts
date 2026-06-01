export type IndicatorDisplaySource = {
  name?: string | null;
  short_name?: string | null;
  code?: string | null;
};

function normalizeValue(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sanitizeIndicatorLabel(rawValue: string) {
  if (!rawValue) return "";

  let value = rawValue
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove machine-style filler prefixes that make labels harder to scan.
  value = value.replace(/^auto\s+/i, "");
  value = value.replace(/^number of\s+/i, "");
  value = value.replace(/^total number of\s+/i, "");
  value = value.replace(/^total\s+/i, "");
  value = value.replace(/^hivpm\s+/i, "");

  value = value.toLowerCase();
  value = value.replace(
    /^(?:people|persons|plwh|key and vulnerable populations|clients|beneficiaries)\s+reached\s+with\s+/,
    "",
  );
  value = value.replace(/^reached\s+with\s+/, "");
  value = value.replace(/\bstis\b/g, "STIs");
  value = value.replace(/\bgbv\b/g, "GBV");
  value = value.replace(/\bhiv\b/g, "HIV");
  value = value.replace(/\bncd\b/g, "NCD");
  value = value.replace(/\bplwh\b/g, "PLWH");
  value = value.replace(/\bprep\b/g, "PrEP");
  value = value.replace(/\bpep\b/g, "PEP");
  value = value.replace(/\bart\b/g, "ART");
  value = value.replace(/\barv\b/g, "ARV");
  value = value.replace(/\bemtct\b/g, "EMTCT");

  return toTitleCase(value).replace(/\bStis\b/g, "STIs");
}

export function getIndicatorDisplayName(
  indicator?: IndicatorDisplaySource | null,
  fallback = "Indicator",
) {
  const shortName = normalizeValue(indicator?.short_name);
  if (shortName) return shortName;

  const name = normalizeValue(indicator?.name);
  if (name) return name;

  return fallback;
}

export function getIndicatorChartLabel(
  indicator?: IndicatorDisplaySource | null,
  fallback = "Indicator",
) {
  const shortName = normalizeValue(indicator?.short_name);
  if (shortName) return shortName;

  const normalizedName = sanitizeIndicatorLabel(normalizeValue(indicator?.name));
  const normalizedCode = sanitizeIndicatorLabel(normalizeValue(indicator?.code));
  const canUseCode =
    normalizedCode.length > 0 &&
    normalizedCode.length <= 24 &&
    normalizedCode.split(/\s+/).length <= 4;
  const source = normalizedName || (canUseCode ? normalizedCode : "") || fallback;

  if (source.length <= 40) return source;
  return source.split(/\s+/).slice(0, 5).join(" ");
}
