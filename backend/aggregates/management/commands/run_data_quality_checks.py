"""Run the Data Quality monitoring suite (Phase 5).

Schedule on the host cron:
  daily   → consistency + anomaly + duplicate + fact-integrity flags
  weekly  → + organization/project quality score snapshots
  monthly → + national quality summary snapshot

Example crontab:
  0 3 * * *  manage.py run_data_quality_checks --frequency daily   --mode live
  0 4 * * 1  manage.py run_data_quality_checks --frequency weekly  --mode live
  0 5 1 * *  manage.py run_data_quality_checks --frequency monthly --mode live
"""
import json

from django.core.management.base import BaseCommand

from aggregates.data_quality_checks import run_all


class Command(BaseCommand):
    help = "Run data-quality consistency, anomaly, duplicate, and fact-integrity checks."

    def add_arguments(self, parser):
        parser.add_argument("--frequency", choices=["daily", "weekly", "monthly"], default="daily")
        parser.add_argument("--mode", choices=["live", "training", "all"], default="live")

    def handle(self, *args, **options):
        summary = run_all(mode=options["mode"], frequency=options["frequency"])
        self.stdout.write(json.dumps(summary, indent=2))
        self.stdout.write(self.style.SUCCESS(
            f"Data quality run complete: {summary['consistency']} consistency, "
            f"{summary['anomaly']} anomaly, {summary['duplicate']} duplicate, "
            f"{summary['fact_integrity']} fact-integrity findings."
        ))
