"""Parity → Data Quality integration + missing-in-db CSV export tests."""
import csv
import importlib.util
import tempfile
from pathlib import Path

from django.test import TestCase

from aggregates.data_quality_checks import ingest_parity_report
from flags.models import Flag
from organizations.models import Organization


class ParityDataQualityTests(TestCase):
    def _report(self):
        joh = Organization.objects.create(name="Journey of Hope", code="PDQ_JOH", type="cso")
        bos = Organization.objects.create(name="BOSASNet", code="PDQ_BOS", type="cso")
        return {
            "project": {"id": 2, "code": "NAHPA2025/26"},
            "orgs": [
                {"org_id": joh.id, "org": "Journey of Hope",
                 "payload_mismatches": 0, "missing_in_db": 17, "missing_in_workbook": 0},
                {"org_id": bos.id, "org": "BOSASNet",
                 "payload_mismatches": 2, "missing_in_db": 43, "missing_in_workbook": 1},
            ],
        }, joh, bos

    def test_missing_in_db_classified_as_completeness(self):
        report, joh, _bos = self._report()
        ingest_parity_report(report, run_label="t")
        flag = Flag.objects.get(content_type="organization", object_id=joh.id,
                                 metadata__category="missing")
        self.assertEqual(flag.flag_type, "data_quality")
        self.assertEqual(flag.metadata["source"], "parity")
        self.assertEqual(flag.metadata["count"], 17)
        self.assertEqual(flag.priority, "medium")  # missing < mismatch severity

    def test_value_mismatch_is_consistency_and_higher_severity(self):
        report, _joh, bos = self._report()
        ingest_parity_report(report, run_label="t")
        consistency = Flag.objects.get(content_type="organization", object_id=bos.id,
                                       metadata__category="consistency")
        self.assertEqual(consistency.priority, "high")  # mismatch > missing
        traceability = Flag.objects.get(content_type="organization", object_id=bos.id,
                                        metadata__category="traceability")
        self.assertEqual(traceability.metadata["count"], 1)

    def test_idempotent_and_autoresolve(self):
        report, joh, _bos = self._report()
        ingest_parity_report(report, run_label="t1")
        ingest_parity_report(report, run_label="t2")  # re-run: no duplicate
        self.assertEqual(
            Flag.objects.filter(object_id=joh.id, metadata__category="missing", status="open").count(), 1
        )
        # Gap cleared → flag auto-resolves.
        report["orgs"][0]["missing_in_db"] = 0
        ingest_parity_report(report, run_label="t3")
        self.assertFalse(
            Flag.objects.filter(object_id=joh.id, metadata__category="missing", status="open").exists()
        )


class MissingInDbCsvTests(TestCase):
    def _load_parity_module(self):
        path = Path(__file__).resolve().parent.parent / "scripts" / "verify_monthly_payload_parity.py"
        spec = importlib.util.spec_from_file_location("verify_monthly_payload_parity", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_csv_export_contains_only_missing_in_db_with_columns(self):
        mod = self._load_parity_module()

        class _Proj:
            id, code, name = 2, "NAHPA2025/26", "NAHPA"

        rows = [
            {"org": "BOSASNet", "quarter": "Q2", "indicator_id": 374,
             "indicator_name": "Breast cancer education", "type": "missing_in_db_payload",
             "workbook": "/imp/BOSASNET.xlsx"},
            {"org": "APSA", "quarter": "Q3", "indicator_id": 366,
             "indicator_name": "Demand creation", "type": "payload_mismatch",
             "workbook": "/imp/APSA.xlsx"},  # must be excluded (not missing_in_db)
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out = mod.write_missing_in_db_csv(Path(tmp), rows, _Proj())
            with open(out, newline="", encoding="utf-8") as fh:
                data = list(csv.reader(fh))
        self.assertEqual(data[0], ["Organization", "Quarter", "Indicator ID", "Indicator Name",
                                   "Project", "Workbook File", "Issue Type"])
        self.assertEqual(len(data), 2)  # header + 1 missing_in_db row (mismatch excluded)
        self.assertEqual(data[1][0], "BOSASNet")
        self.assertEqual(data[1][5], "BOSASNET.xlsx")  # workbook basename
        self.assertEqual(data[1][6], "missing_in_db_payload")
