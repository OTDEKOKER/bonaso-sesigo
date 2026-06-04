from django.core.management.base import BaseCommand, CommandError

from uploads.jobs import run_aggregate_export_job
from uploads.models import ExportJob


class Command(BaseCommand):
    help = "Process an ExportJob in a separate worker process."

    def add_arguments(self, parser):
        parser.add_argument("job_id", type=int)

    def handle(self, *args, **options):
        job_id = options["job_id"]
        try:
            job = ExportJob.objects.get(id=job_id)
        except ExportJob.DoesNotExist as exc:
            raise CommandError(f"ExportJob not found: {job_id}") from exc

        if job.job_type != "aggregate_export":
            raise CommandError(f"Unsupported export job type: {job.job_type}")

        processed = run_aggregate_export_job(job.id)
        self.stdout.write(
            self.style.SUCCESS(f"ExportJob {processed.id} finished with status {processed.status}")
        )
