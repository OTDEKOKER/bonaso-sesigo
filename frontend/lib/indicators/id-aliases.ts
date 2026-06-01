export type IndicatorAliasDefinition = {
  canonical: string;
  aliases: number[];
};

export const INDICATOR_ALIASES: Record<number, IndicatorAliasDefinition> = {
  // Community-led monitoring
  443: {
    canonical:
      "Number of community-led monitoring activities conducted for quality of service and human rights",
    aliases: [364],
  },

  // GBV clinical services
  463: {
    canonical: "Number of people eligible for clinical services for GBV",
    aliases: [344],
  },
  464: {
    canonical: "Number of people referred for clinical services for GBV",
    aliases: [345],
  },

  // GBV justice services
  465: {
    canonical: "Number of people eligible for justice services for GBV",
    aliases: [346, 459],
  },
  466: {
    canonical: "Number of people referred for justice services for GBV",
    aliases: [347],
  },
  460: {
    canonical: "Number of people linked to justice services",
    aliases: [341, 474],
  },

  // GBV psychosocial support
  540: {
    canonical: "Number of people eligible for psychosocial support for GBV",
    aliases: [348, 467],
  },
  541: {
    canonical: "Number of people referred for psychosocial support for GBV",
    aliases: [349, 479],
  },
  350: {
    canonical: "Number of people who received psychosocial support on GBV",
    aliases: [],
  },

  // Legal aid
  458: {
    canonical: "Number of people provided with legal aid services",
    aliases: [340, 473],
  },

  // HIV testing
  451: {
    canonical: "Number of people tested for HIV",
    aliases: [332],
  },
  331: {
    canonical: "Number of people referred for HIV testing",
    aliases: [445],
  },
  333: {
    canonical: "Number of people who tested positive for HIV",
    aliases: [452],
  },

  // PEP / PrEP
  338: {
    canonical: "Number of people eligible for PEP",
    aliases: [],
  },
  337: {
    canonical: "Number of people referred for PrEP",
    aliases: [],
  },
  339: {
    canonical: "Number of people referred for PEP",
    aliases: [446],
  },

  // STI services
  352: {
    canonical: "Number of people screened positive for STIs referred for services",
    aliases: [468],
  },
  353: {
    canonical: "Number of STI cases linked to care",
    aliases: [469],
  },
  354: {
    canonical: "Number of STI referrals completed",
    aliases: [470, 511],
  },

  // Condoms
  543: {
    canonical: "Number of people who reported collecting condoms for the repeated time",
    aliases: [356, 449, 480],
  },

  // Lubricants
  472: {
    canonical: "Total number of lubricants distributed",
    aliases: [357],
  },

  // NCDs
  544: {
    canonical: "Number of people reached with NCD prevention messages",
    aliases: [372],
  },
  520: {
    canonical: "Number of people referred for diabetes treatment/management services",
    aliases: [384],
  },
  416: {
    canonical: "Number of functional tobacco cessation and alcohol abuse support groups",
    aliases: [521],
  },
  320: {
    canonical: "Number of sub-recipients submitting quality reports per month",
    aliases: [371],
  },

  // TB treatment indicator phrasing alignment
  525: {
    canonical: "Number of PLWH who tested positive for TB and are on treatment",
    aliases: [482],
  },
};

const CANONICAL_BY_ALIAS_ID = new Map<number, number>();
for (const [canonicalIdRaw, definition] of Object.entries(INDICATOR_ALIASES)) {
  const canonicalId = Number(canonicalIdRaw);
  if (!Number.isFinite(canonicalId)) continue;
  CANONICAL_BY_ALIAS_ID.set(canonicalId, canonicalId);
  for (const aliasId of definition.aliases) {
    CANONICAL_BY_ALIAS_ID.set(Number(aliasId), canonicalId);
  }
}

const NAME_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\belligible\b/gi, "eligible"],
  [/\breffered\b/gi, "referred"],
  [/\bpyschosocial\b/gi, "psychosocial"],
  [/\bdescrimination\b/gi, "discrimination"],
  [/\bcoodinators\b/gi, "coordinators"],
  [/\bperforamance\b/gi, "performance"],
  [/\bidentifies needs\b/gi, "identified needs"],
  [/\bfield visists\b/gi, "field visits"],
  [/\bvirsual presentations\b/gi, "visual presentations"],
  [/\bredness\b/gi, "redress"],
  [/\bnumber of number of people\b/gi, "Number of people"],
  [/\bnumber of number of\b/gi, "Number of"],
  [/\bNumber OF\b/g, "Number of"],
];

export function resolveIndicatorId(indicatorId: string | number | null | undefined): number {
  const numericId = Number(indicatorId);
  if (!Number.isFinite(numericId)) return Number.NaN;
  return CANONICAL_BY_ALIAS_ID.get(numericId) ?? numericId;
}

export function resolveIndicatorIdString(indicatorId: string | number | null | undefined): string {
  const resolvedId = resolveIndicatorId(indicatorId);
  if (!Number.isFinite(resolvedId)) return String(indicatorId ?? "");
  return String(resolvedId);
}

export function getCanonicalIndicatorLabelById(
  indicatorId: string | number | null | undefined,
): string | null {
  const resolvedId = resolveIndicatorId(indicatorId);
  if (!Number.isFinite(resolvedId)) return null;
  return INDICATOR_ALIASES[resolvedId]?.canonical ?? null;
}

export function normalizeIndicatorDisplayName(value: string | null | undefined): string {
  let normalized = String(value || "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of NAME_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, " ").trim();
}
