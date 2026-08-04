"""Delete expired CSO Mapping drafts (personal-data minimisation).

Run on a schedule (e.g. daily cron) so abandoned drafts holding personal data do
not outlive their configured retention window. Expiry is by server time against
each draft's ``expires_at`` (refreshed on every save from
``CSO_MAPPING_DRAFT_TTL_DAYS``).
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from cso_mapping.models import CsoMappingDraft


class Command(BaseCommand):
    help = "Delete expired CSO Mapping questionnaire drafts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report how many drafts would be deleted without deleting them.",
        )

    def handle(self, *args, **options):
        now = timezone.now()
        try:
            expired = CsoMappingDraft.objects.filter(expires_at__lt=now)
            count = expired.count()
            if options["dry_run"]:
                self.stdout.write(f"{now.isoformat()} [dry-run] {count} expired draft(s) would be deleted.")
                return
            expired.delete()
        except Exception as exc:  # log only the type — never PII/tokens; exit non-zero
            raise CommandError(f"{now.isoformat()} cleanup failed: {type(exc).__name__}") from exc
        self.stdout.write(f"{now.isoformat()} deleted {count} expired draft(s).")
