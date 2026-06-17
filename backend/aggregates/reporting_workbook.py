"""SESIGO Reporting Workbook generator + importer.

This module powers a familiar, donor-style reporting workbook (similar to the
NAHPA reporting templates) so that data submitters never touch technical
columns such as ``indicator_id`` / ``project_id`` / ``organization_id``.

The design goal is a *reliable* round-trip. Rather than fuzzy-matching sheet
names and indicator titles (the legacy template filler in ``views.py``), every
generated workbook carries two hidden machine sheets:

  * ``Metadata``  — project / organization / quarter / version, etc.
  * ``_cellmap``  — for every numeric input cell, the exact JSON path
                    (``primary`` / ``secondary`` / ``band``) it maps to.

Because of ``_cellmap`` the importer reconstructs the canonical aggregate
``value`` payload deterministically, regardless of how many disaggregation
dimensions an indicator has. The visible ``Reporting Form`` sheet mirrors the
on-screen ``AggregateMatrixTable``: its columns are derived from each
indicator's ``aggregate_disaggregation_config`` (the "indicator matrix").

The ``value`` shape produced here matches what the capture UI submits via
``buildEntryMatrixPayload``::

    {"disaggregates": {primary: {secondary: {band: number}}}, "total": number}

so existing dashboards, the review queue and analytics read it unchanged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.protection import WorkbookProtection

# Bump the minor version for backwards-compatible layout tweaks; bump the major
# version (and gate the importer) for breaking changes to the cell map schema.
WORKBOOK_VERSION = "sesigo-reporting-workbook/1"

SHEET_INSTRUCTIONS = "Instructions"
SHEET_FORM = "Reporting Form"
SHEET_META = "Metadata"
SHEET_CELLMAP = "_cellmap"

MATRIX_SEXES = ["Male", "Female"]
NO_BAND = "Value"
ALL_PRIMARY = "All"

# Workbook protection password — deters casual structural edits / un-hiding the
# machine sheets. The importer reads protected workbooks without it.
PROTECTION_PASSWORD = "sesigo"

# Reporting Form column layout — mirrors the NAHPA consolidated reporting form:
# indicator | key-population | sex | age-band columns… | Sub-total | TOTAL | AYP
COL_NAME = 1        # A  (indicator name, merged down the block)
COL_KP = 2          # B  (primary disaggregate: key population / message / role)
COL_SEX = 3         # C  (secondary disaggregate: sex)
COL_BAND_START = 4  # D  (age-band columns, or a single value column)

AYP_LABEL = "AYP (10-24)"

# ── Styling ──────────────────────────────────────────────────────────────────
_HEADER_FILL = PatternFill(start_color="000000", end_color="000000", fill_type="solid")
_HEADCELL_FILL = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
_LABEL_FILL = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid")
_INPUT_FILL = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid")
_SUBTOTAL_FILL = PatternFill(start_color="BFBFBF", end_color="BFBFBF", fill_type="solid")
_GRANDTOTAL_FILL = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
_WHITE_BOLD = Font(bold=True, color="FFFFFF")
_BOLD = Font(bold=True)
_CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
_THIN = Side(style="thin", color="808080")
_BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)

# Locked vs unlocked: by default Excel treats every cell as locked, but the lock
# only bites once sheet protection is on. We unlock the numeric input cells so
# users can type there; everything else (labels, headers, auto-sum formulas)
# stays locked.
_LOCKED = Protection(locked=True)
_UNLOCKED = Protection(locked=False)


# ── Quarter / period helpers ─────────────────────────────────────────────────
def quarter_period_range(quarter: int, fiscal_start_year: int) -> tuple[date, date]:
    """Return (period_start, period_end) for a Botswana fiscal quarter.

    Fiscal year runs Apr 1 → Mar 31. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec,
    Q4=Jan-Mar (of the following calendar year). ``fiscal_start_year`` is the
    calendar year the fiscal year starts in (e.g. 2025 for FY 2025/26).
    """
    q = int(quarter)
    y = int(fiscal_start_year)
    if q == 1:
        return date(y, 4, 1), date(y, 6, 30)
    if q == 2:
        return date(y, 7, 1), date(y, 9, 30)
    if q == 3:
        return date(y, 10, 1), date(y, 12, 31)
    if q == 4:
        return date(y + 1, 1, 1), date(y + 1, 3, 31)
    raise ValueError(f"Quarter must be 1-4, received {quarter!r}")


def fiscal_year_label(fiscal_start_year: int) -> str:
    y = int(fiscal_start_year)
    return f"{y}/{str(y + 1)[-2:]}"


def quarter_label(quarter: int, fiscal_start_year: int) -> str:
    return f"Q{int(quarter)} {fiscal_year_label(fiscal_start_year)}"


_QUARTER_LABEL_RE = re.compile(
    r"^Q([1-4])\s+(\d{4})(?:\s*/\s*(?:\d{2}|\d{4}))?$", re.IGNORECASE
)


def parse_quarter_label(label: str) -> tuple[int, int] | None:
    """Parse ``"Q3 2025/26"`` (or ``"Q3 2025"``) → (quarter, fiscal_start_year)."""
    m = _QUARTER_LABEL_RE.match(str(label or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def period_to_quarter(period_start: date, period_end: date) -> tuple[int, int] | None:
    """Inverse of :func:`quarter_period_range`, used when only dates are known."""
    for q in (1, 2, 3, 4):
        for fy in (period_start.year, period_start.year - 1):
            start, end = quarter_period_range(q, fy)
            if start == period_start and end == period_end:
                return q, fy
    return None


# ── Indicator matrix resolution (ports getAggregateEntryMatrixConfig) ─────────
def _norm(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def normalize_band_label(label) -> str:
    """Canonicalise an age-band label's *whitespace* without changing its range.

    Partner workbooks sometimes store the same age band under inconsistent
    spellings — ``"0 - 4"``/``"0-4"``, ``"5- 10"``/``"5-10"``, ``"30 -39"``/
    ``"30-39"`` — which makes one band render as two near-identical columns in the
    reporting workbook. This collapses the spaces *around the hyphen* and any
    repeated internal whitespace so those spellings map to a single band. It does
    NOT alter the numbers in a band or the band boundaries (e.g. ``"65+"`` stays
    ``"65+"``, ``"18-24"`` stays ``"18-24"``), so intentionally different age
    ranges (e.g. an indicator using social-media age ranges) are untouched.
    """
    text = str(label or "").strip()
    text = re.sub(r"\s*-\s*", "-", text)  # "0 - 4" / "5- 10" / "30 -39" -> "0-4" / "5-10" / "30-39"
    text = re.sub(r"\s+", " ", text)       # collapse any other doubled spaces
    return text


def _dim_tokens(dim: dict) -> set[str]:
    # Token-based so "messages" never matches "age", etc.
    return set(_norm(dim.get("key")).split()) | set(_norm(dim.get("label")).split())


def _is_age_dimension(dim: dict) -> bool:
    return "age" in _dim_tokens(dim)


def _is_sex_dimension(dim: dict) -> bool:
    tokens = _dim_tokens(dim)
    return "sex" in tokens or "gender" in tokens


@dataclass
class MatrixConfig:
    has_disaggregates: bool
    primary_label: str
    primary_values: list[str]
    secondary_label: str
    secondary_values: list[str]
    band_label: str
    band_values: list[str]


def resolve_matrix_config(indicator) -> MatrixConfig:
    """Resolve an indicator's disaggregation matrix exactly like the capture UI.

    Mirrors ``getAggregateEntryMatrixConfig``: non-special dimensions become the
    primary (and possibly secondary) axes, the sex dimension is preferred as the
    secondary axis, and the age dimension becomes the band (column) axis.
    """
    # Percentage indicators are a single rate, not a sex/age count breakdown:
    # summing disaggregate cells into a total is meaningless and would breach the
    # "percentage cannot exceed 100" rule. Render a single value cell.
    if getattr(indicator, "type", "") == "percentage":
        return MatrixConfig(False, "Indicator", [], "Category", [], "Value", [])

    config = getattr(indicator, "aggregate_disaggregation_config", None) or {}
    dimensions = config.get("dimensions") if isinstance(config, dict) else None
    enabled = bool(config.get("enabled", True)) if isinstance(config, dict) else False
    dimensions = [d for d in (dimensions or []) if isinstance(d, dict)]

    if not enabled or not dimensions:
        return MatrixConfig(False, "Indicator", [], "Category", [], "Value", [])

    age_dim = next((d for d in dimensions if _is_age_dimension(d)), None)
    sex_dim = next((d for d in dimensions if _is_sex_dimension(d)), None)
    non_special = [d for d in dimensions if not _is_age_dimension(d) and not _is_sex_dimension(d)]

    primary_dim = non_special[0] if non_special else None
    secondary_dim = sex_dim or (non_special[1] if len(non_special) > 1 else None)

    def _values(dim, fallback):
        vals = [str(v) for v in (dim.get("values") or [])] if dim else []
        return vals or fallback

    primary_values = _values(primary_dim, [ALL_PRIMARY])
    if secondary_dim is None:
        secondary_values = [ALL_PRIMARY]
    elif _is_sex_dimension(secondary_dim):
        secondary_values = _values(secondary_dim, list(MATRIX_SEXES))
    else:
        secondary_values = _values(secondary_dim, [ALL_PRIMARY])
    # Normalise band-label whitespace and drop the duplicates it produces so a
    # band stored as both "0 - 4" and "0-4" renders as one column (not two).
    band_values = list(dict.fromkeys(normalize_band_label(b) for b in _values(age_dim, [NO_BAND])))

    return MatrixConfig(
        has_disaggregates=True,
        primary_label=(primary_dim or {}).get("label") or "Category",
        primary_values=primary_values,
        secondary_label=(secondary_dim or {}).get("label") or "Category",
        secondary_values=secondary_values,
        band_label=(age_dim or {}).get("label") or "Value",
        band_values=band_values,
    )


def iter_cells(cfg: MatrixConfig):
    """Yield every (primary, secondary, band) input-cell coordinate."""
    for primary in cfg.primary_values:
        for secondary in cfg.secondary_values:
            for band in cfg.band_values:
                yield primary, secondary, band


# ── value <-> cells ──────────────────────────────────────────────────────────
def _to_number(raw):
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return raw
    text = str(raw).strip().replace(",", "")
    if not text:
        return None
    try:
        num = float(text)
    except ValueError:
        return None
    return int(num) if num.is_integer() else num


def build_value_from_cells(cells: dict[tuple[str, str, str], float], cfg: MatrixConfig):
    """Reconstruct the canonical aggregate ``value`` from filled-in cells.

    ``cells`` maps (primary, secondary, band) -> number. Returns the nested
    ``{"disaggregates": ..., "total": ...}`` payload, or ``None`` when nothing
    was entered for the indicator.
    """
    numeric = {k: _to_number(v) for k, v in cells.items()}
    if not any(v is not None for v in numeric.values()):
        return None

    if not cfg.has_disaggregates:
        # Single value indicators are stored as a plain total.
        total = next((v for v in numeric.values() if v is not None), 0)
        return {"total": total}

    disaggregates: dict = {}
    total = 0
    for (primary, secondary, band), value in numeric.items():
        amount = value or 0
        disaggregates.setdefault(primary, {}).setdefault(secondary, {})[band] = amount
        total += amount
    return {"disaggregates": disaggregates, "total": total}


def extract_cells_from_value(value, cfg: MatrixConfig) -> dict[tuple[str, str, str], float]:
    """Best-effort inverse of :func:`build_value_from_cells` for pre-filling.

    Reads an existing aggregate ``value`` into the (primary, secondary, band)
    grid so the "Download Existing Data Workbook" round-trips.
    """
    cells: dict[tuple[str, str, str], float] = {}
    if value is None:
        return cells

    if not cfg.has_disaggregates:
        total = None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            total = value
        elif isinstance(value, dict):
            total = value.get("total")
        if total is not None:
            cells[(ALL_PRIMARY, ALL_PRIMARY, NO_BAND)] = total
        return cells

    disaggregates = value.get("disaggregates") if isinstance(value, dict) else None
    if isinstance(disaggregates, dict):
        for primary, secondary_map in disaggregates.items():
            if not isinstance(secondary_map, dict):
                continue
            for secondary, band_map in secondary_map.items():
                if isinstance(band_map, dict):
                    for band, amount in band_map.items():
                        # Normalise band whitespace and merge duplicates (e.g. a
                        # value stored under "0 - 4" lands in the same "0-4" cell
                        # as one stored under "0-4"), summing to preserve totals.
                        key = (str(primary), str(secondary), normalize_band_label(band))
                        existing = cells.get(key)
                        if isinstance(existing, (int, float)) and isinstance(amount, (int, float)):
                            cells[key] = existing + amount
                        else:
                            cells[key] = amount
                else:
                    cells[(str(primary), str(secondary), NO_BAND)] = band_map

    # Legacy {"male": n, "female": n} payloads for sex-only indicators.
    if not disaggregates and isinstance(value, dict):
        for sex in MATRIX_SEXES:
            amount = value.get(sex.lower())
            if amount is not None:
                cells[(ALL_PRIMARY, sex, NO_BAND)] = amount
    return cells


# ── Workbook generation ──────────────────────────────────────────────────────
@dataclass
class IndicatorPlan:
    indicator: object
    config: MatrixConfig
    target: float | None
    existing_cells: dict[tuple[str, str, str], float] = field(default_factory=dict)


def generate_workbook(
    *,
    project,
    organization,
    quarter: int,
    fiscal_start_year: int,
    indicator_plans: list[IndicatorPlan],
    generated_by: str = "",
    with_data: bool = False,
) -> BytesIO:
    """Build the multi-sheet reporting workbook and return it as a BytesIO."""
    period_start, period_end = quarter_period_range(quarter, fiscal_start_year)

    wb = Workbook()
    form = wb.active
    form.title = SHEET_FORM
    meta = wb.create_sheet(SHEET_META)
    cellmap = wb.create_sheet(SHEET_CELLMAP)
    instructions = wb.create_sheet(SHEET_INSTRUCTIONS)

    cellmap_rows: list[list] = [
        ["indicator_id", "indicator_code", "kind", "primary", "secondary", "band", "coordinate"]
    ]

    # ── Reporting Form ──
    form.sheet_view.showGridLines = False
    form.column_dimensions[get_column_letter(COL_NAME)].width = 34
    form.column_dimensions[get_column_letter(COL_KP)].width = 16
    form.column_dimensions[get_column_letter(COL_SEX)].width = 10

    # Numbers-only validation shared by every input cell (whole numbers >= 0).
    number_validation = DataValidation(
        type="whole", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
    )
    number_validation.showErrorMessage = True
    number_validation.errorTitle = "Numbers only"
    number_validation.error = "Please enter a whole number (0 or more)."
    number_validation.promptTitle = "Enter a number"
    number_validation.prompt = "Type a whole number of people/events for this cell."
    form.add_data_validation(number_validation)
    # Collect input-cell coordinates here; bind them to the validation in one
    # shot after all blocks are written (see _input_cell).
    number_validation._pending_coords = []

    title = f"{project.name} — {organization.name}"
    form.cell(row=1, column=COL_NAME, value=title).font = Font(bold=True, size=14)
    form.cell(row=2, column=COL_NAME, value=f"{quarter_label(quarter, fiscal_start_year)}  ({period_start} to {period_end})").font = _BOLD
    form.cell(
        row=3, column=COL_NAME,
        value="Enter whole numbers in the light-blue cells only. Totals fill in automatically. The sheet is protected; do not unprotect, rename or delete sheets.",
    ).font = Font(italic=True, color="808080")

    row = 5
    for plan in indicator_plans:
        row = _write_indicator_block(
            form, row, plan, cellmap_rows, number_validation, with_data=with_data
        )
        row += 1  # spacer

    # Bind every collected input cell to the numeric validation in a single
    # assignment (one MultiCellRange build instead of thousands).
    if number_validation._pending_coords:
        number_validation.sqref = " ".join(number_validation._pending_coords)
    del number_validation._pending_coords

    # Lock the sheet: only the unlocked light-blue input cells are editable;
    # labels, headers and auto-sum formulas stay locked.
    form.protection.sheet = True
    form.protection.password = PROTECTION_PASSWORD
    form.protection.formatColumns = False
    form.protection.formatRows = False

    # ── Metadata (hidden) ──
    meta_pairs = [
        ("workbook_version", WORKBOOK_VERSION),
        ("project_id", project.id),
        ("project_code", getattr(project, "code", "") or ""),
        ("project_name", project.name),
        ("organization_id", organization.id),
        ("organization_code", getattr(organization, "code", "") or ""),
        ("organization_name", organization.name),
        ("quarter", quarter),
        ("fiscal_start_year", fiscal_start_year),
        ("fiscal_year", fiscal_year_label(fiscal_start_year)),
        ("quarter_label", quarter_label(quarter, fiscal_start_year)),
        ("period_start", period_start.isoformat()),
        ("period_end", period_end.isoformat()),
        ("is_training", "true" if getattr(project, "is_training", False) else "false"),
        ("generated_at", datetime.utcnow().isoformat() + "Z"),
        ("generated_by", generated_by or ""),
        ("indicator_count", len(indicator_plans)),
    ]
    meta.cell(row=1, column=1, value="key").font = _BOLD
    meta.cell(row=1, column=2, value="value").font = _BOLD
    for i, (key, val) in enumerate(meta_pairs, start=2):
        meta.cell(row=i, column=1, value=key)
        meta.cell(row=i, column=2, value=val)
    meta.column_dimensions["A"].width = 22
    meta.column_dimensions["B"].width = 48
    meta.sheet_state = "hidden"

    # ── _cellmap (hidden) ──
    for r, values in enumerate(cellmap_rows, start=1):
        for c, val in enumerate(values, start=1):
            cellmap.cell(row=r, column=c, value=val)
    cellmap.sheet_state = "veryHidden"

    # ── Instructions ──
    _write_instructions(instructions, project, organization, quarter, fiscal_start_year)

    # Keep the form active/selected on open.
    wb.active = wb.sheetnames.index(SHEET_FORM)

    # Lock workbook structure so the hidden Metadata/_cellmap sheets cannot be
    # unhidden, reordered or deleted in Excel (the importer reads them anyway).
    wb.security = WorkbookProtection(workbookPassword=PROTECTION_PASSWORD, lockStructure=True)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


_AYP_RANGE_RE = re.compile(r"^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$")
_AYP_SINGLE_RE = re.compile(r"^\s*(\d{1,2})\s*$")


def _band_in_ayp(band: str) -> bool:
    """True when an age band falls entirely within the AYP window (10-24)."""
    m = _AYP_RANGE_RE.match(str(band))
    if m:
        return int(m.group(1)) >= 10 and int(m.group(2)) <= 24
    m = _AYP_SINGLE_RE.match(str(band))
    if m:
        return 10 <= int(m.group(1)) <= 24
    return False


def _style(cell, *, fill=None, font=None, align=_CENTER, locked=True):
    if fill is not None:
        cell.fill = fill
    if font is not None:
        cell.font = font
    cell.alignment = align
    cell.border = _BORDER
    cell.protection = _LOCKED if locked else _UNLOCKED
    return cell


def _merge(ws, r1, c1, r2, c2, value, *, fill=None, font=None, align=_CENTER):
    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
    for rr in range(r1, r2 + 1):
        for cc in range(c1, c2 + 1):
            _style(ws.cell(row=rr, column=cc), fill=fill, font=font, align=align)
    top_left = ws.cell(row=r1, column=c1, value=value)
    _style(top_left, fill=fill, font=font, align=align)
    return top_left


def _input_cell(ws, row, col, dv, value=None):
    cell = _style(ws.cell(row=row, column=col), fill=_INPUT_FILL, locked=False)
    if value is not None:
        cell.value = value
    # Defer validation binding: collecting coordinates and setting ``dv.sqref``
    # once (in generate_workbook) avoids openpyxl rebuilding the MultiCellRange
    # on every single ``dv.add`` — that per-cell rebuild is O(n^2) and was the
    # dominant cost when a form has thousands of input cells (6s+ -> sub-second).
    coll = getattr(dv, "_pending_coords", None)
    if coll is not None:
        coll.append(cell.coordinate)
    else:
        dv.add(cell)
    return cell


def _write_indicator_block(ws, start_row, plan: IndicatorPlan, cellmap_rows, dv, *, with_data):
    """Write one indicator in the NAHPA consolidated reporting layout.

    Columns: indicator name | key population | sex | age bands… | Sub-total |
    TOTAL (per key population) | AYP (10-24). Followed by a Sub-total row and
    (for sex-disaggregated indicators) TOTAL MALE / TOTAL FEMALE rows. Every
    cell is bordered; only the light-blue age cells are unlocked + numeric.
    """
    indicator = plan.indicator
    cfg = plan.config
    name = (getattr(indicator, "name", "") or "").strip()
    try:
        category = (indicator.get_category_display() or "").upper()
    except Exception:
        category = "REPORTING"

    def _record(kind, primary, secondary, band, cell):
        cellmap_rows.append([
            indicator.id, getattr(indicator, "code", "") or "", kind,
            primary, secondary, band, f"{ws.title}!{cell.coordinate}",
        ])

    # ── Plain (no disaggregation): name | "Total" | single value. ──
    if not cfg.has_disaggregates:
        _merge(ws, start_row, COL_NAME, start_row, COL_KP, name or category,
               fill=_LABEL_FILL, font=_BOLD, align=_LEFT)
        _style(ws.cell(row=start_row, column=COL_SEX, value="Total"), fill=_LABEL_FILL, font=_BOLD)
        cell = _input_cell(ws, start_row, COL_BAND_START, dv)
        if with_data:
            amount = plan.existing_cells.get((ALL_PRIMARY, ALL_PRIMARY, NO_BAND))
            if amount is not None:
                cell.value = amount
        _record("total", "", "", "", cell)
        return start_row + 1

    bands = cfg.band_values
    has_age = bands != [NO_BAND]
    primary_vals = cfg.primary_values
    sec_vals = cfg.secondary_values
    has_kp = primary_vals != [ALL_PRIMARY]
    has_sex = sec_vals != [ALL_PRIMARY]
    is_sex = has_sex and all(v in MATRIX_SEXES for v in sec_vals)

    n_bands = len(bands)
    first_band = COL_BAND_START
    last_band = COL_BAND_START + n_bands - 1
    col_sub = (last_band + 1) if has_age else None
    col_total = (col_sub if col_sub else last_band) + 1
    col_ayp = (col_total + 1) if has_age else None
    last_col = col_ayp or col_total

    for c in range(first_band, last_band + 1):
        ws.column_dimensions[get_column_letter(c)].width = 7
    for c in (col_sub, col_total, col_ayp):
        if c:
            ws.column_dimensions[get_column_letter(c)].width = 10

    # ── Header bar ──
    hr = start_row
    _merge(ws, hr, COL_NAME, hr, COL_KP, category, fill=_HEADER_FILL, font=_WHITE_BOLD, align=_LEFT)
    _style(ws.cell(row=hr, column=COL_SEX, value="AGE/SEX" if has_age else "SEX"),
           fill=_HEADCELL_FILL, font=_BOLD)
    band_cols: dict[str, int] = {}
    for i, band in enumerate(bands):
        c = first_band + i
        _style(ws.cell(row=hr, column=c, value=band if has_age else "Count"),
               fill=_HEADCELL_FILL, font=_BOLD)
        band_cols[band] = c
    if col_sub:
        _style(ws.cell(row=hr, column=col_sub, value="Sub - total"), fill=_HEADCELL_FILL, font=_BOLD)
    _style(ws.cell(row=hr, column=col_total, value="TOTAL"), fill=_HEADCELL_FILL, font=_BOLD)
    if col_ayp:
        _style(ws.cell(row=hr, column=col_ayp, value=AYP_LABEL), fill=_HEADCELL_FILL, font=_BOLD)

    # ── Data rows ──
    data_start = hr + 1
    row = data_start
    male_subs: list[str] = []
    female_subs: list[str] = []
    for primary in primary_vals:
        kp_first = row
        for secondary in sec_vals:
            if has_sex:
                _style(ws.cell(row=row, column=COL_SEX, value=secondary), fill=_LABEL_FILL, font=_BOLD)
            else:
                _style(ws.cell(row=row, column=COL_SEX, value="Count"), fill=_LABEL_FILL, font=_BOLD)
            for band in bands:
                cell = _input_cell(ws, row, band_cols[band], dv)
                if with_data:
                    amount = plan.existing_cells.get((primary, secondary, band))
                    if amount is not None:
                        cell.value = amount
                _record("cell", primary, secondary, band, cell)
            if col_sub:
                sub_ref = f"{get_column_letter(col_sub)}{row}"
                _style(ws.cell(row=row, column=col_sub,
                               value=f"=SUM({get_column_letter(first_band)}{row}:{get_column_letter(last_band)}{row})"),
                       fill=_SUBTOTAL_FILL, font=_BOLD)
                if is_sex and secondary == "Male":
                    male_subs.append(sub_ref)
                elif is_sex and secondary == "Female":
                    female_subs.append(sub_ref)
            if col_ayp:
                ayp_refs = [f"{get_column_letter(band_cols[b])}{row}" for b in bands if _band_in_ayp(b)]
                ws_ayp = ws.cell(row=row, column=col_ayp,
                                 value=("=" + "+".join(ayp_refs)) if ayp_refs else 0)
                _style(ws_ayp, fill=_SUBTOTAL_FILL, font=_BOLD)
            row += 1
        kp_last = row - 1
        # Key-population label (col B), merged across its sex rows.
        _merge(ws, kp_first, COL_KP, kp_last, COL_KP, primary if has_kp else "All",
               fill=_LABEL_FILL, font=_BOLD, align=_CENTER)
        # TOTAL per key population (sum of its rows' sub-totals), merged.
        if col_sub:
            total_formula = f"=SUM({get_column_letter(col_sub)}{kp_first}:{get_column_letter(col_sub)}{kp_last})"
        else:
            total_formula = (
                f"=SUM({get_column_letter(first_band)}{kp_first}:{get_column_letter(last_band)}{kp_last})"
                if has_age else
                f"=SUM({get_column_letter(first_band)}{kp_first}:{get_column_letter(first_band)}{kp_last})"
            )
        _merge(ws, kp_first, col_total, kp_last, col_total, total_formula,
               fill=_SUBTOTAL_FILL, font=_BOLD)
    data_end = row - 1

    # Indicator name down the left, spanning the whole block.
    _merge(ws, data_start, COL_NAME, data_end, COL_NAME, name, fill=_HEADCELL_FILL, font=_BOLD, align=_LEFT)

    # ── Sub-total row (column sums) ──
    _merge(ws, row, COL_NAME, row, COL_SEX, "Sub - total", fill=_SUBTOTAL_FILL, font=_BOLD)
    for band in bands:
        c = band_cols[band]
        _style(ws.cell(row=row, column=c,
                       value=f"=SUM({get_column_letter(c)}{data_start}:{get_column_letter(c)}{data_end})"),
               fill=_SUBTOTAL_FILL, font=_BOLD)
    if col_sub:
        _style(ws.cell(row=row, column=col_sub,
                       value=f"=SUM({get_column_letter(col_sub)}{data_start}:{get_column_letter(col_sub)}{data_end})"),
               fill=_SUBTOTAL_FILL, font=_BOLD)
    _style(ws.cell(row=row, column=col_total,
                   value=f"=SUM({get_column_letter(first_band)}{data_start}:{get_column_letter(last_band)}{data_end})"),
           fill=_SUBTOTAL_FILL, font=_BOLD)
    if col_ayp:
        _style(ws.cell(row=row, column=col_ayp,
                       value=f"=SUM({get_column_letter(col_ayp)}{data_start}:{get_column_letter(col_ayp)}{data_end})"),
               fill=_SUBTOTAL_FILL, font=_BOLD)
    row += 1

    # ── TOTAL MALE / TOTAL FEMALE rows (sex-disaggregated indicators only) ──
    if is_sex:
        for label, refs in (("TOTAL MALE", male_subs), ("TOTAL FEMALE", female_subs)):
            _merge(ws, row, COL_NAME, row, COL_SEX, label, fill=_GRANDTOTAL_FILL, font=_WHITE_BOLD)
            value = ("=" + "+".join(refs)) if refs else 0
            _merge(ws, row, first_band, row, last_col, value, fill=_GRANDTOTAL_FILL, font=_WHITE_BOLD)
            row += 1

    return row


def _write_instructions(ws, project, organization, quarter, fiscal_start_year):
    ws.column_dimensions["A"].width = 100
    lines = [
        ("How to complete this workbook", 14, True),
        ("", 11, False),
        (f"Project: {project.name} ({getattr(project, 'code', '') or '—'})", 11, True),
        (f"Organization: {organization.name}", 11, True),
        (f"Reporting period: {quarter_label(quarter, fiscal_start_year)}", 11, True),
        ("", 11, False),
        ("1. Go to the 'Reporting Form' sheet.", 11, False),
        ("2. Enter your counts in the yellow input cells only.", 11, False),
        ("3. Each indicator shows the disaggregation breakdown it requires (e.g. sex, age, key population).", 11, False),
        ("4. Leave cells blank where you have no data. Blank indicators are skipped on upload.", 11, False),
        ("5. Totals are calculated automatically — do not overwrite Total columns.", 11, False),
        ("6. Do NOT rename, reorder or delete rows, columns or sheets.", 11, False),
        ("7. The hidden 'Metadata' and '_cellmap' sheets identify this workbook — leave them untouched.", 11, False),
        ("", 11, False),
        ("Validation rules", 12, True),
        ("• Values must be whole, non-negative numbers.", 11, False),
        ("• Percentage indicators cannot exceed 100.", 11, False),
        ("• Re-download a fresh workbook if you change project, organization or quarter.", 11, False),
        ("", 11, False),
        ("Uploading", 12, True),
        ("Return to the Aggregates page and choose 'Upload Workbook'. The system reads the project,", 11, False),
        ("organization and quarter automatically from this file — you never enter ID columns.", 11, False),
    ]
    for i, (text, size, bold) in enumerate(lines, start=1):
        cell = ws.cell(row=i, column=1, value=text)
        cell.font = Font(bold=bold, size=size)
        cell.alignment = _LEFT
    ws.sheet_view.showGridLines = False


# ── Workbook parsing / validation ────────────────────────────────────────────
class WorkbookError(Exception):
    """Raised with a list of friendly validation messages."""

    def __init__(self, messages: list[str]):
        self.messages = messages
        super().__init__("; ".join(messages))


@dataclass
class ParsedIndicator:
    indicator_id: int
    indicator_code: str
    value: dict


@dataclass
class ParsedWorkbook:
    metadata: dict
    indicators: list[ParsedIndicator]
    warnings: list[str] = field(default_factory=list)


def parse_workbook(file_obj) -> ParsedWorkbook:
    """Parse + validate an uploaded reporting workbook.

    Raises :class:`WorkbookError` with friendly, user-facing messages when the
    workbook is not a recognisable SESIGO reporting workbook.
    """
    try:
        wb = load_workbook(file_obj, data_only=True, read_only=True)
    except Exception:
        raise WorkbookError([
            "We could not open this file as an Excel workbook.",
            "Please download a fresh workbook and try again.",
        ])

    try:
        missing_sheets = [s for s in (SHEET_META, SHEET_FORM, SHEET_CELLMAP) if s not in wb.sheetnames]
        if missing_sheets:
            raise WorkbookError([
                "This file is not a SESIGO reporting workbook.",
                "Missing: " + ", ".join(missing_sheets),
                "Please use 'Download Workbook' to get a valid template.",
            ])

        metadata = _read_metadata(wb[SHEET_META])
        problems: list[str] = []

        version = str(metadata.get("workbook_version") or "")
        if not version.startswith("sesigo-reporting-workbook/"):
            problems.append("Unrecognised workbook version (this file was not generated by SESIGO).")
        for key, label in (("project_id", "Project"), ("organization_id", "Organization"), ("quarter", "Quarter")):
            if not metadata.get(key):
                problems.append(f"Missing {label} information.")
        if problems:
            raise WorkbookError(["Workbook Validation Failed", *problems,
                                 "Please download a fresh workbook and try again."])

        form = wb[SHEET_FORM]
        indicators = _read_cellmap_values(wb[SHEET_CELLMAP], form)
        return ParsedWorkbook(metadata=metadata, indicators=indicators)
    finally:
        wb.close()


def _read_metadata(ws) -> dict:
    metadata: dict = {}
    for row in ws.iter_rows(min_row=2, max_col=2, values_only=True):
        if not row:
            continue
        key, value = (row[0], row[1] if len(row) > 1 else None)
        if key is None:
            continue
        metadata[str(key).strip()] = value
    # Coerce the numeric identifiers we rely on.
    for key in ("project_id", "organization_id", "quarter", "fiscal_start_year"):
        if key in metadata and metadata[key] is not None:
            try:
                metadata[key] = int(metadata[key])
            except (TypeError, ValueError):
                pass
    return metadata


def _read_cellmap_values(cellmap_ws, form_ws) -> list[ParsedIndicator]:
    # Snapshot the form once (read_only sheets are forward-only).
    form_values: dict[str, object] = {}
    for row in form_ws.iter_rows(values_only=False):
        for cell in row:
            if cell.value is not None:
                form_values[cell.coordinate] = cell.value

    grouped: dict[int, dict] = {}
    order: list[int] = []
    rows = list(cellmap_ws.iter_rows(min_row=2, values_only=True))
    for raw in rows:
        if not raw or raw[0] is None:
            continue
        indicator_id, code, kind, primary, secondary, band, coordinate = (list(raw) + [None] * 7)[:7]
        try:
            indicator_id = int(indicator_id)
        except (TypeError, ValueError):
            continue
        coord = str(coordinate or "")
        if "!" in coord:
            coord = coord.split("!", 1)[1]
        cell_value = form_values.get(coord)
        if indicator_id not in grouped:
            grouped[indicator_id] = {"code": str(code or ""), "total": None, "cells": {}}
            order.append(indicator_id)
        bucket = grouped[indicator_id]
        if kind == "total":
            bucket["total"] = cell_value
        else:
            bucket["cells"][(str(primary), str(secondary), str(band))] = cell_value

    parsed: list[ParsedIndicator] = []
    for indicator_id in order:
        bucket = grouped[indicator_id]
        value = _bucket_to_value(bucket)
        if value is None:
            continue  # nothing entered for this indicator → skip
        parsed.append(ParsedIndicator(indicator_id, bucket["code"], value))
    return parsed


def _bucket_to_value(bucket) -> dict | None:
    cells = bucket["cells"]
    if cells:
        numeric = {k: _to_number(v) for k, v in cells.items()}
        if not any(v is not None for v in numeric.values()):
            return None
        disaggregates: dict = {}
        total = 0
        for (primary, secondary, band), value in numeric.items():
            amount = value or 0
            disaggregates.setdefault(primary, {}).setdefault(secondary, {})[band] = amount
            total += amount
        return {"disaggregates": disaggregates, "total": total}
    total = _to_number(bucket["total"])
    if total is None:
        return None
    return {"total": total}
