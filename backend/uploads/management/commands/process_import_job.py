from django.core.management.base import BaseCommand, CommandError

from uploads.jobs import run_aggregate_review_import_job
from uploads.models import ImportJob


class Command(BaseCommand):
    help = "Process an ImportJob in a separate worker process."

    def add_arguments(self, parser):
        parser.add_argument("job_id", type=int)

    def handle(self, *args, **options):
        job_id = options["job_id"]
        try:
            job = ImportJob.objects.get(id=job_id)
        except ImportJob.DoesNotExist as exc:
            raise CommandError(f"ImportJob not found: {job_id}") from exc

        if job.job_type != "aggregate_review_import":
            raise CommandError(f"Unsupported import job type: {job.job_type}")

        processed = run_aggregate_review_import_job(job.id)
        self.stdout.write(
            self.style.SUCCESS(f"ImportJob {processed.id} finished with status {processed.status}")
        )
