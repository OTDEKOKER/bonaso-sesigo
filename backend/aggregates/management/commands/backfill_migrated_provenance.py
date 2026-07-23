"""Close the audit-trail provenance gap on bulk-migrated aggregates (audit W1).

Some historical aggregates entered the database through data-migration scripts
rather than the API, so they are ``status='approved'`` yet carry neither a
``created_by`` nor a ``reviewed_by``. There is nothing wrong with the *values* —
they were reconciled against the end-of-year workbooks — but the audit trail
cannot show who captured or approved them, which the certification audit flags
as an integrity/traceability gap.

This command makes that provenance explicit **without changing any reported
value, status, period, indicator, organisation or project**. It only:

  * (report, default) counts and breaks down the affected rows; or
  * (``--apply``) appends a clearly-worded provenance marker to each row's
    free-text ``notes`` (preserving any existing note text) and records ONE
    summary event in the audit stream.

It is idempotent — a row already carrying the marker is skipped — and it never
runs unless ``--apply`` is passed. Dry-run is the default so it is safe to run
at any time to inspect the gap.

    # inspect only (no writes):
    python manage.py backfill_migrated_provenance

    # actually stamp provenance (writes notes + one audit event):
    python manage.py backfill_migrated_provenance --apply
"""
from __future__ import annotations

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from aggregates.models import Aggregate
from audit.recording import record_audit_event

# Idempotency marker. Kept stable so re-runs recognise already-stamped rows.
PROVENANCE_MARKER = (
    '[Provenance: bulk-migrated historical record — original data collector and '
    'reviewer were not captured at migration time. Value reconciled against the '
    'end-of-year source workbook. See audit event W1-provenance-backfill.]'
)


class Command(BaseCommand):
    help = (
        'Stamp audit-trail provenance onto approved aggregates that were '
        'bulk-migrated (no created_by and no reviewed_by). Report-only unless '
        '--apply is given. Never changes a reported value or status.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Write the provenance marker + audit event. Without this the '
                 'command only reports (dry run).',
        )
        parser.add_argument(
            '--project',
            type=int,
            default=None,
            help='Restrict to a single project id (optional).',
        )

    def _target_queryset(self, project_id):
        qs = Aggregate.objects.filter(
            status='approved',
            reviewed_by__isnull=True,
            created_by__isnull=True,
        )
        if project_id is not None:
            qs = qs.filter(project_id=project_id)
        return qs

    def handle(self, *args, **options):
        apply = options['apply']
        project_id = options['project']

        qs = self._target_queryset(project_id)
        total = qs.count()

        if total == 0:
            self.stdout.write(self.style.SUCCESS(
                'No provenance-gap aggregates found (nothing to do).'
            ))
            return

        # Breakdown for the operator to review before applying.
        by_project = Counter(qs.values_list('project__code', flat=True))
        already_marked = qs.filter(notes__contains='W1-provenance-backfill').count()
        to_stamp = total - already_marked

        self.stdout.write(f'Provenance-gap approved aggregates: {total}')
        self.stdout.write(f'  already marked (idempotent skip): {already_marked}')
        self.stdout.write(f'  would be stamped this run:        {to_stamp}')
        self.stdout.write('  by project:')
        for code, n in by_project.most_common():
            self.stdout.write(f'    {code or "(no code)"}: {n}')

        if not apply:
            self.stdout.write(self.style.WARNING(
                '\nDRY RUN — no changes written. Re-run with --apply to stamp '
                'provenance (notes + one audit event).'
            ))
            return

        stamped = 0
        with transaction.atomic():
            # Only touch rows that are not already marked. Append the marker on a
            # new line so any existing note text is preserved verbatim.
            pending = qs.exclude(notes__contains='W1-provenance-backfill').only(
                'id', 'notes'
            )
            for aggregate in pending.iterator():
                existing = (aggregate.notes or '').rstrip()
                aggregate.notes = (
                    f'{existing}\n{PROVENANCE_MARKER}' if existing else PROVENANCE_MARKER
                )
                aggregate.save(update_fields=['notes', 'updated_at'])
                stamped += 1

            record_audit_event(
                action='update',
                object_type='aggregate_provenance_backfill',
                description=(
                    f'W1 provenance backfill: stamped {stamped} bulk-migrated '
                    'approved aggregate(s) that had no created_by/reviewed_by. '
                    'No reported value or status was changed.'
                ),
                metadata={
                    'finding': 'W1',
                    'stamped': stamped,
                    'already_marked': already_marked,
                    'total_gap': total,
                    'project_filter': project_id,
                },
            )

        self.stdout.write(self.style.SUCCESS(
            f'\nStamped provenance on {stamped} aggregate(s) and recorded one '
            'audit event. Values and statuses unchanged.'
        ))
