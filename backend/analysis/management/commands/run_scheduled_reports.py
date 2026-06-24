"""Execute due scheduled reports (cron-driven).

Cron example (host, like the other compose-exec jobs):
  */15 * * * * cd /home/bonasoadmin/BONASOV1/frontend && docker compose -f compose.server.yaml exec -T backend python manage.py run_scheduled_reports >> .../scheduled_reports/cron.log 2>&1
"""
import json

from django.core.management.base import BaseCommand

from analysis.scheduled_reports import run_due


class Command(BaseCommand):
    help = "Generate + email any scheduled reports whose next_run is due."

    def handle(self, *args, **options):
        summary = run_due()
        self.stdout.write(json.dumps(summary.get("results", []), indent=2, default=str))
        self.stdout.write(self.style.SUCCESS(
            f"Scheduled reports: ran {summary['ran']}, "
            f"{summary['succeeded']} succeeded, {summary['failed']} failed."
        ))
