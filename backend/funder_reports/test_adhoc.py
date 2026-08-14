"""Ad-hoc figure-generation helper tests (pure, no DB).

The end-to-end reuse of the funder engine is exercised against real data in the
existing generation suite; these lock the ad-hoc shim + input parsing that let
/explore drive FigureGenerator without a saved ReportFigure.
"""
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from funder_reports.models import Dimension, ChartType, TargetMode, CalculationMode, MappingRole
from funder_reports.views import _parse_id_list, _validate_choice, _AdHocFigure


class _Ind:
    def __init__(self, id):
        self.id = id
        self.name = f"Indicator {id}"


class AdHocHelperTests(SimpleTestCase):
    def test_parse_id_list_from_csv_and_list(self):
        self.assertEqual(_parse_id_list("1,2,3"), [1, 2, 3])
        self.assertEqual(_parse_id_list([1, "2", 3]), [1, 2, 3])
        self.assertEqual(_parse_id_list(""), [])
        self.assertEqual(_parse_id_list("a, 3 ,,4"), [3, 4])  # skips junk

    def test_validate_choice(self):
        self.assertEqual(_validate_choice("sex", Dimension.choices, "group_by"), "sex")
        with self.assertRaises(ValidationError):
            _validate_choice("not-a-dimension", Dimension.choices, "group_by")

    def test_adhoc_figure_shim_matches_engine_contract(self):
        fig = _AdHocFigure(
            indicators=[_Ind(10), _Ind(20)],
            grouping_dimension=Dimension.INDICATOR,
            chart_type=ChartType.GROUPED_BAR,
            target_mode=TargetMode.NONE,
            calculation_mode=CalculationMode.NONE,
            title="cmp",
        )
        # the exact attributes/relations FigureGenerator reads
        maps = fig.mappings.select_related("indicator").all()
        self.assertEqual([m.indicator_id for m in maps], [10, 20])
        self.assertTrue(all(m.role == MappingRole.ACHIEVED for m in maps))
        self.assertEqual(fig.filters.all(), [])
        self.assertEqual(fig.secondary_grouping_dimension, Dimension.NONE)
        self.assertIsNone(fig.id)
        self.assertEqual(fig.figure_number, "")
