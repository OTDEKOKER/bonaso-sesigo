/**
 * Single-year → five-year age-group folding for the analysis / reports surface.
 *
 * Mirrors the authoritative server rule in
 * `backend/analysis/services/age_bands.py`. Single-year age keys ("10".."64")
 * are folded into the standard five-year group whose range contains them
 * (10,11,12,13,14 → "10-14"); anything >= 65 → "65+". Range labels ("10-14")
 * and the open "65+" band pass through unchanged.
 *
 * This is applied only when rolling up data across organizations (the
 * consolidated analysis/reports views), so single ages stay visible in the
 * per-organization aggregates capture/matrix views.
 */

const SINGLE_AGE_RE = /^\s*(\d{1,2})\s*$/;

export function singleAgeGroupLabel(label: string): string | null {
  const match = SINGLE_AGE_RE.exec(String(label ?? ""));
  if (!match) return null;
  const age = Number(match[1]);
  if (age >= 65) return "65+";
  const start = Math.floor(age / 5) * 5;
  return `${start}-${start + 4}`;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mergeNodes<T>(existing: T | undefined, incoming: T): T {
  if (existing === undefined || existing === null) return incoming;
  if (isNumber(existing) && isNumber(incoming)) {
    return (existing + incoming) as unknown as T;
  }
  if (
    existing && incoming &&
    typeof existing === "object" && typeof incoming === "object" &&
    !Array.isArray(existing) && !Array.isArray(incoming)
  ) {
    const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      merged[key] = mergeNodes(merged[key], value);
    }
    return merged as unknown as T;
  }
  return incoming;
}

/**
 * Recursively fold single-year age keys into their five-year group, summing
 * collisions. Non-age keys and group/open-band keys are preserved. The input is
 * not mutated.
 */
export function foldSingleAgesIntoGroups<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((item) => foldSingleAgesIntoGroups(item)) as unknown as T;
  }
  if (node && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const foldedChild = foldSingleAgesIntoGroups(child);
      const newKey = singleAgeGroupLabel(key) ?? key;
      result[newKey] = newKey in result ? mergeNodes(result[newKey], foldedChild) : foldedChild;
    }
    return result as unknown as T;
  }
  return node;
}
