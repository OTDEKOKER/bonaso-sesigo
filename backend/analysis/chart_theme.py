"""
Canonical Sesigo chart colour palette — the single source of truth shared by
the web charts (frontend/lib/chart-theme.ts) and the Excel chart export.

Audit finding: chart colours were defined in three+ unrelated places (a
hard-coded array in AggregateChartDialog, theme CSS variables, and one-off hex
literals), so the same series rendered different colours in different views and
the Excel export used none of them. Both ends now resolve series colours from
this ordered list so a series keeps its colour everywhere — UI and download.

Keep this list byte-for-byte identical to SESIGO_CHART_PALETTE in
frontend/lib/chart-theme.ts.
"""
from __future__ import annotations

# BONASO/Sesigo brand-derived qualitative palette (hex, no leading mixing with
# theme CSS vars so the colours are stable and exportable).
SESIGO_CHART_PALETTE: list[str] = [
    "#20A3D3",  # sky blue (primary)
    "#0FA546",  # green
    "#CC0000",  # red
    "#6F35A5",  # purple
    "#F1A100",  # amber
    "#0A2B73",  # navy
    "#93C94D",  # lime
    "#AFC4D8",  # slate
    "#E0529C",  # pink
    "#1D7A6E",  # teal
]

# Semantic colours used by target/achievement and status charts so they match
# the UI (achieved/target/late/missing etc.).
SESIGO_SEMANTIC_COLORS: dict[str, str] = {
    "total": "#20A3D3",
    "achieved": "#0FA546",
    "target": "#0A2B73",
    "submitted": "#0FA546",
    "late": "#F1A100",
    "missing": "#CC0000",
    "over_target": "#16a34a",
}


def normalize_hex(color: str | None) -> str:
    """Return a 6-digit uppercase hex (no leading '#') suitable for openpyxl.

    openpyxl's solidFill wants 'RRGGBB' or 'AARRGGBB'. Accepts '#RRGGBB',
    'RRGGBB', or 3-digit '#RGB'. Falls back to the first palette colour for any
    value openpyxl could not use (e.g. an unresolved 'hsl(var(--chart-2))').
    """
    fallback = SESIGO_CHART_PALETTE[0].lstrip("#").upper()
    if not color:
        return fallback
    value = str(color).strip().lstrip("#")
    if len(value) == 3 and all(c in "0123456789abcdefABCDEF" for c in value):
        value = "".join(c * 2 for c in value)
    if len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value):
        return value.upper()
    if len(value) == 8 and all(c in "0123456789abcdefABCDEF" for c in value):
        return value.upper()
    return fallback


def series_color(index: int, explicit: str | None = None) -> str:
    """Resolve a series colour: an explicit hex wins, else cycle the palette."""
    if explicit:
        return normalize_hex(explicit)
    return normalize_hex(SESIGO_CHART_PALETTE[index % len(SESIGO_CHART_PALETTE)])
