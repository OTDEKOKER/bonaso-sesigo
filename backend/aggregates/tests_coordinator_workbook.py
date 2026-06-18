"""Tests for the coordinator rollup workbook (one sheet per sub + TOTAL sheet).

The TOTAL sheet's cells must SUM the *matching* (indicator, primary, secondary,
band) cell on each sub that reports that indicator — not a blind same-coordinate
reference — even though subs have different indicator subsets.
"""
import re
from io import BytesIO
from types import SimpleNamespace

from django.test import SimpleTestCase
from openpyxl import load_workbook

from aggregates import reporting_workbook as rw

STD = ['10-14','15-19','20-24','25-29','30-34','35-39','40-44','45-49','50-54','55-59','60-64','65+']


def _indicator(iid, code, name):
    return SimpleNamespace(
        id=iid, code=code, name=name, type="number",
        aggregate_disaggregation_config={
            "enabled": True,
            "dimensions": [
                {"label": "Sex", "key": "sex", "values": ["Male", "Female"]},
                {"label": "Age Range", "key": "age_band", "values": list(STD)},
            ],
        },
    )


def _plan(ind):
    return rw.IndicatorPlan(indicator=ind, config=rw.resolve_matrix_config(ind), target=None, existing_cells={})


class CoordinatorWorkbookTests(SimpleTestCase):
    def _build(self):
        i1 = _indicator(1, "IND1", "Indicator One")
        i2 = _indicator(2, "IND2", "Indicator Two")
        project = SimpleNamespace(id=99, name="Test Project", code="TP", is_training=False)
        coord = SimpleNamespace(id=5, name="Coordinator Org", code="COORD")
        subA = SimpleNamespace(id=11, name="Sub A", code="A")
        subB = SimpleNamespace(id=12, name="Sub B", code="B")
        # Sub A reports only indicator 1; Sub B reports both (different layouts).
        sub_specs = [(subA, [_plan(i1)]), (subB, [_plan(i2), _plan(i1)])]
        coord_plans = [_plan(i1), _plan(i2)]
        buf = rw.generate_coordinator_workbook(
            project=project, coordinator=coord, sub_specs=sub_specs,
            coordinator_plans=coord_plans, quarter=1, fiscal_start_year=2026,
        )
        return load_workbook(BytesIO(buf.getvalue()))

    def test_has_total_sheet_last_and_one_sheet_per_sub(self):
        wb = self._build()
        visible = [s.title for s in wb.worksheets if s.sheet_state == "visible"]
        self.assertEqual(visible[-1], rw.SHEET_TOTAL)  # TOTAL is the last visible sheet
        self.assertIn("Sub A", visible)
        self.assertIn("Sub B", visible)

    def test_total_cells_reference_matching_indicator_cells(self):
        wb = self._build()
        cm = wb["_cellmap"]
        by_sheet = {}
        for r in cm.iter_rows(values_only=True):
            ind_id, code, kind, primary, secondary, band, coord = r
            if kind not in ("cell", "total"):
                continue
            sheet, cell = str(coord).split("!", 1)
            by_sheet.setdefault(sheet, {})[cell] = (ind_id, primary, secondary, band)

        total = wb[rw.SHEET_TOTAL]
        checked = ref_to_a = 0
        for row in total.iter_rows():
            for c in row:
                v = c.value
                if not (isinstance(v, str) and v.startswith("=SUM(") and "'!" in v):
                    continue
                tot_key = by_sheet[total.title][c.coordinate]
                for sheet, cell in re.findall(r"'([^']+)'!([A-Z]+\d+)", v):
                    checked += 1
                    # every ref must point at the SAME indicator/band on the sub
                    self.assertEqual(by_sheet[sheet][cell], tot_key)
                    if sheet == "Sub A":
                        ref_to_a += 1
        self.assertGreater(checked, 0)
        # Indicator 1 (in both subs) → Sub A is referenced; indicator 2 (only Sub
        # B) → its total cells reference only Sub B. So Sub A appears for IND1 only.
        self.assertGreater(ref_to_a, 0)

    def test_formula_cells_have_cached_values_not_empty(self):
        """openpyxl emits ``<f>…</f><v/>`` (empty cached value); Excel "repairs"
        cross-sheet rollup formulas that carry an empty cached value. The workbook
        must ship every formula cell with an explicit ``<v>0</v>`` (recomputed on
        open via fullCalcOnLoad) and zero empty ``<v/>`` left behind."""
        import zipfile
        i1 = _indicator(1, "IND1", "Indicator One")
        i2 = _indicator(2, "IND2", "Indicator Two")
        project = SimpleNamespace(id=99, name="Test Project", code="TP", is_training=False)
        coord = SimpleNamespace(id=5, name="Coordinator Org", code="COORD")
        subA = SimpleNamespace(id=11, name="Sub A", code="A")
        subB = SimpleNamespace(id=12, name="Sub B", code="B")
        buf = rw.generate_coordinator_workbook(
            project=project, coordinator=coord,
            sub_specs=[(subA, [_plan(i1)]), (subB, [_plan(i2), _plan(i1)])],
            coordinator_plans=[_plan(i1), _plan(i2)], quarter=1, fiscal_start_year=2026,
        )
        empty = cached = formulas = 0
        with zipfile.ZipFile(BytesIO(buf.getvalue())) as z:
            for name in z.namelist():
                if name.startswith("xl/worksheets/") and name.endswith(".xml"):
                    xml = z.read(name).decode("utf-8")
                    formulas += xml.count("</f>")
                    empty += len(re.findall(r"</f><v\s*/>", xml))
                    empty += xml.count("</f><v></v>")
                    cached += len(re.findall(r"</f><v>0</v>", xml))
        self.assertGreater(formulas, 0)
        self.assertEqual(empty, 0, "formula cells must not ship an empty <v/> cached value")
        self.assertEqual(cached, formulas, "every formula cell should carry an explicit cached value")

    def test_indicator_only_in_one_sub_sums_only_that_sub(self):
        wb = self._build()
        cm = wb["_cellmap"]
        # find an IND2 cell on the total sheet
        total_title = rw.SHEET_TOTAL
        ind2_coord = None
        for r in cm.iter_rows(values_only=True):
            ind_id, code, kind, primary, secondary, band, coord = r
            if ind_id == 2 and kind == "cell" and str(coord).startswith(total_title + "!"):
                ind2_coord = str(coord).split("!", 1)[1]
                break
        self.assertIsNotNone(ind2_coord)
        formula = wb[total_title][ind2_coord].value
        self.assertIn("'Sub B'!", formula)
        self.assertNotIn("'Sub A'!", formula)  # Sub A doesn't report IND2
