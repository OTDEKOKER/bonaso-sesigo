export type IndicatorLite = {
  id: string | number;
  name?: string;
  code?: string;
};

export type IndicatorLinkRule = {
  id: string;
  parentPatterns: string[];
  childPatterns: string[];
};

export const INDICATOR_LINK_RULES: IndicatorLinkRule[] = [
  {
    id: "hiv-tested-ayp-into-all-ages",
    parentPatterns: ["hiv", "test"],
    childPatterns: ["hiv", "test", "ayp"],
  },
];

const AGE_SCOPE_TOKENS = [
  "ayp",
  "adolescent",
  "adolescents",
  "youth",
  "10 24",
  "10-24",
  "10 14",
  "10-14",
  "15 19",
  "15-19",
  "20 24",
  "20-24",
  "young people",
  "young person",
];

const ALL_AGES_TOKENS = ["all age", "all ages", "all age group", "all age groups", "overall"];

export const normalizeIndicatorText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const matchesPatterns = (text: string, patterns: string[]) =>
  patterns.every((pattern) => text.includes(normalizeIndicatorText(pattern)));

const hasAnyToken = (text: string, tokens: string[]) =>
  tokens.some((token) => text.includes(normalizeIndicatorText(token)));

const removeScopeTokens = (text: string) => {
  let next = text;
  [...AGE_SCOPE_TOKENS, ...ALL_AGES_TOKENS].forEach((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\b${escaped}\\b`, "g"), " ");
  });
  return next.replace(/\s+/g, " ").trim();
};

const getIndicatorText = (indicator: IndicatorLite) =>
  normalizeIndicatorText(`${indicator.name || ""} ${indicator.code || ""}`);

export const buildIndicatorGroupKey = (indicator: IndicatorLite) => {
  const text = getIndicatorText(indicator);
  const base = removeScopeTokens(text);
  return base || text;
};

export const rollupLinkedIndicatorTotals = (
  indicators: IndicatorLite[],
  totalsByIndicatorId: Map<string, number>,
) => {
  const rolled = new Map(totalsByIndicatorId);
  const consumedChildren = new Set<string>();

  for (const rule of INDICATOR_LINK_RULES) {
    const parentIds = indicators
      .filter((indicator) => matchesPatterns(getIndicatorText(indicator), rule.parentPatterns))
      .map((indicator) => String(indicator.id));

    const childIds = indicators
      .filter((indicator) => matchesPatterns(getIndicatorText(indicator), rule.childPatterns))
      .map((indicator) => String(indicator.id))
      .filter((id) => !parentIds.includes(id));

    const childTotal = childIds.reduce((sum, id) => sum + (rolled.get(id) || 0), 0);
    if (childTotal <= 0 || parentIds.length === 0) continue;

    childIds.forEach((id) => consumedChildren.add(id));
    parentIds.forEach((id) => {
      rolled.set(id, (rolled.get(id) || 0) + childTotal);
    });
  }

  const groups = new Map<
    string,
    Array<{ id: string; text: string; scoped: boolean; allAges: boolean }>
  >();

  indicators.forEach((indicator) => {
    const id = String(indicator.id);
    if (consumedChildren.has(id)) return;
    const text = getIndicatorText(indicator);
    const scoped = hasAnyToken(text, AGE_SCOPE_TOKENS);
    const allAges = hasAnyToken(text, ALL_AGES_TOKENS);
    const base = removeScopeTokens(text);
    if (!base) return;
    const list = groups.get(base) || [];
    list.push({ id, text, scoped, allAges });
    groups.set(base, list);
  });

  groups.forEach((items) => {
    const parents = items.filter((item) => !item.scoped || item.allAges);
    const children = items.filter((item) => item.scoped && !parents.some((parent) => parent.id === item.id));
    if (parents.length === 0 || children.length === 0) return;

    const childTotal = children.reduce((sum, child) => sum + (rolled.get(child.id) || 0), 0);
    if (childTotal <= 0) return;

    parents.forEach((parent) => {
      rolled.set(parent.id, (rolled.get(parent.id) || 0) + childTotal);
    });
  });

  return rolled;
};
