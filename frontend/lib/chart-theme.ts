/**
 * Canonical Sesigo chart colour palette — the single source of truth shared by
 * the web charts and the native Excel chart export (backend
 * analysis/chart_theme.py).
 *
 * Audit finding: chart colours lived in several unrelated places (a hard-coded
 * array in AggregateChartDialog, theme CSS variables like hsl(var(--chart-2)),
 * and one-off hex literals), so a series could render one colour on screen and
 * a different one elsewhere, and the Excel export ignored them entirely. Both
 * the UI and the export now resolve series colours from this ordered list so a
 * series keeps its colour everywhere.
 *
 * Keep this list byte-for-byte identical to SESIGO_CHART_PALETTE in
 * backend/analysis/chart_theme.py.
 */
export const SESIGO_CHART_PALETTE = [
  "#20A3D3", // sky blue (primary)
  "#0FA546", // green
  "#CC0000", // red
  "#6F35A5", // purple
  "#F1A100", // amber
  "#0A2B73", // navy
  "#93C94D", // lime
  "#AFC4D8", // slate
  "#E0529C", // pink
  "#1D7A6E", // teal
] as const;

/** Semantic colours for target/achievement and status charts (match the UI). */
export const SESIGO_SEMANTIC_COLORS = {
  total: "#20A3D3",
  achieved: "#0FA546",
  target: "#0A2B73",
  submitted: "#0FA546",
  late: "#F1A100",
  missing: "#CC0000",
  overTarget: "#16a34a",
} as const;

/** Resolve a series colour by index (cycles the palette). */
export function seriesColor(index: number): string {
  return SESIGO_CHART_PALETTE[index % SESIGO_CHART_PALETTE.length];
}

/**
 * Resolve a colour for an Excel export: an explicit 6-digit hex wins; anything
 * else (e.g. an unresolved "hsl(var(--chart-2))") cycles the palette so the
 * export never falls back to Excel's random theme colours.
 */
export function exportColor(index: number, explicit?: string | null): string {
  if (explicit && /^#?[0-9a-fA-F]{6}$/.test(explicit.trim())) {
    const v = explicit.trim();
    return v.startsWith("#") ? v : `#${v}`;
  }
  return seriesColor(index);
}
