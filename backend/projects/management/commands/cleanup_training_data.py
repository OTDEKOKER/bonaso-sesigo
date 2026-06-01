"""
Management command: cleanup_training_data

Deletes (or dry-runs) training data older than a configurable number of days.
Only records linked to projects where is_training=True are ever touched.
Production data is never deleted.

Usage:
    python manage.py cleanup_training_data --older-than-days 7
    python manage.py cleanup_training_data --older-than-days 7 --dry-run
"""

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Clean up training/demo data older than N days. Never touches production data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than-days",
            type=int,
            default=7,
            dest="older_than_days",
            help="Delete training records created more than this many days ago (default: 7).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            dest="dry_run",
            help="Show what would be deleted without actually deleting anything.",
        )

    def handle(self, *args, **options):
        older_than_days = options["older_than_days"]
        dry_run = options["dry_run"]
        cutoff = timezone.now() - timedelta(days=older_than_days)

        self.stdout.write("")
        self.stdout.write("=" * 60)
        self.stdout.write("Training data cleanup started")
        self.stdout.write(f"Older than:  {older_than_days} days (cutoff: {cutoff.date()})")
        self.stdout.write(
            f"Mode:        {'DRY RUN - no data will be deleted' if dry_run else 'LIVE - records will be deleted'}"
        )
        self.stdout.write("=" * 60)

        try:
            from projects.models import Project
        except Exception as exc:
            self.stderr.write(f"Cannot import Project model: {exc}")
            return

        training_projects = list(Project.objects.filter(is_training=True))
        self.stdout.write(f"Training projects found: {len(training_projects)}")

        if not training_projects:
            self.stdout.write("No training projects found. Nothing to clean up.")
            self.stdout.write("=" * 60)
            return

        total_summary = {
            "aggregates_deleted": 0,
            "interactions_deleted": 0,
            "narrative_reports_deleted": 0,
            "import_jobs_deleted": 0,
            "tasks_deleted": 0,
            "deadlines_deleted": 0,
            "activities_deleted": 0,
            "production_records_touched": 0,
        }

        for project in training_projects:
            if not project.is_training:
                logger.warning("Skipping project %s: is_training is False", project.pk)
                continue

            self.stdout.write("")
            self.stdout.write(f"Project: {project.name} (id={project.pk})")

            project_summary = self._cleanup_project(project, cutoff, dry_run)

            for key, count in project_summary.items():
                total_summary[key] = total_summary.get(key, 0) + count
                if count > 0:
                    label = key.replace("_", " ").capitalize()
                    action = "Would delete" if dry_run else "Deleted"
                    self.stdout.write(f"  {action}: {count} {label}")

        self.stdout.write("")
        self.stdout.write("-" * 60)
        self.stdout.write("Summary")
        self.stdout.write("-" * 60)
        for key, count in total_summary.items():
            label = key.replace("_", " ").capitalize()
            self.stdout.write(f"  {label}: {count}")

        self.stdout.write("")
        if dry_run:
            self.stdout.write("DRY RUN complete — no data was deleted.")
        else:
            self.stdout.write("Cleanup completed successfully.")
        self.stdout.write("Production records touched: 0")
        self.stdout.write("=" * 60)
        self.stdout.write("")

    def _cleanup_project(self, project, cutoff, dry_run):
        summary = {
            "aggregates_deleted": 0,
            "interactions_deleted": 0,
            "narrative_reports_deleted": 0,
            "import_jobs_deleted": 0,
            "tasks_deleted": 0,
            "deadlines_deleted": 0,
            "activities_deleted": 0,
            "production_records_touched": 0,
        }

        # Safety: never touch a project that isn't explicitly marked training.
        if not project.is_training:
            logger.error(
                "SAFETY ABORT: _cleanup_project called on non-training project %s. Skipping.",
                project.pk,
            )
            return summary

        # --- Aggregate records ---
        try:
            from aggregates.models import Aggregate

            agg_qs = Aggregate.objects.filter(project=project, created_at__lt=cutoff)
            summary["aggregates_deleted"] = agg_qs.count()
            if not dry_run and summary["aggregates_deleted"]:
                agg_qs.delete()
                logger.info(
                    "Deleted %d aggregate records for training project %s",
                    summary["aggregates_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up aggregates for project %s: %s", project.pk, exc)

        # --- Interactions (and their child Responses via CASCADE) ---
        try:
            from respondents.models import Interaction

            interaction_qs = Interaction.objects.filter(
                project=project, created_at__lt=cutoff
            )
            summary["interactions_deleted"] = interaction_qs.count()
            if not dry_run and summary["interactions_deleted"]:
                interaction_qs.delete()
                logger.info(
                    "Deleted %d interactions for training project %s",
                    summary["interactions_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up interactions for project %s: %s", project.pk, exc)

        # --- Import jobs whose parameters reference this training project ---
        try:
            from uploads.models import ImportJob

            # ImportJob.parameters is a JSONField; look for project_id match.
            # We use Python-level filtering rather than a JSON lookup to stay
            # compatible with both SQLite and PostgreSQL without dialect-specific
            # JSON operators.
            candidate_jobs = ImportJob.objects.filter(created_at__lt=cutoff)
            training_job_ids = []
            for job in candidate_jobs.only("id", "parameters"):
                params = job.parameters or {}
                pid = params.get("project_id") or params.get("project")
                try:
                    if pid is not None and int(pid) == project.pk:
                        training_job_ids.append(job.id)
                except (TypeError, ValueError):
                    pass

            if training_job_ids:
                job_qs = ImportJob.objects.filter(id__in=training_job_ids)
                summary["import_jobs_deleted"] = len(training_job_ids)
                if not dry_run:
                    job_qs.delete()
                    logger.info(
                        "Deleted %d import jobs for training project %s",
                        summary["import_jobs_deleted"],
                        project.pk,
                    )
        except Exception as exc:
            logger.warning("Could not clean up import jobs for project %s: %s", project.pk, exc)

        # --- Narrative reports ---
        try:
            nr_qs = project.narrative_reports.filter(created_at__lt=cutoff)
            summary["narrative_reports_deleted"] = nr_qs.count()
            if not dry_run and summary["narrative_reports_deleted"]:
                nr_qs.delete()
                logger.info(
                    "Deleted %d narrative reports for training project %s",
                    summary["narrative_reports_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up narrative reports for project %s: %s", project.pk, exc)

        # --- Tasks ---
        try:
            task_qs = project.tasks.filter(created_at__lt=cutoff)
            summary["tasks_deleted"] = task_qs.count()
            if not dry_run and summary["tasks_deleted"]:
                task_qs.delete()
                logger.info(
                    "Deleted %d tasks for training project %s",
                    summary["tasks_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up tasks for project %s: %s", project.pk, exc)

        # --- Deadlines ---
        try:
            dl_qs = project.deadlines.filter(created_at__lt=cutoff)
            summary["deadlines_deleted"] = dl_qs.count()
            if not dry_run and summary["deadlines_deleted"]:
                dl_qs.delete()
                logger.info(
                    "Deleted %d deadlines for training project %s",
                    summary["deadlines_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up deadlines for project %s: %s", project.pk, exc)

        # --- Project activities ---
        try:
            pa_qs = project.activities.filter(created_at__lt=cutoff)
            summary["activities_deleted"] = pa_qs.count()
            if not dry_run and summary["activities_deleted"]:
                pa_qs.delete()
                logger.info(
                    "Deleted %d activities for training project %s",
                    summary["activities_deleted"],
                    project.pk,
                )
        except Exception as exc:
            logger.warning("Could not clean up activities for project %s: %s", project.pk, exc)

        return summary
