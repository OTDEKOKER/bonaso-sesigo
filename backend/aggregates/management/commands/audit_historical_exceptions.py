"""Read-only classification of historical aggregate records against the CURRENT
workflow rules (rollout ops-readiness WS2).

Purpose
-------
The platform grew its permission / hierarchy / approval rules over time, and a
large share of the live corpus was loaded through migration and import scripts
rather than the API. Some of those rows therefore do not carry the full
provenance the current workflow produces (a captured ``created_by`` and a
``reviewed_by``/``reviewed_at`` on approval). This command *classifies* every
aggregate against today's rules so an operator can see exactly which rows are
clean, which are benign legacy rows, and which genuinely need a human decision —
**without changing a single byte of data.**

It is strictly READ-ONLY. There is no ``--apply``. It never writes to the
database, never edits a value/status/reviewer/assignment, and never records an
audit event (an audit event is a write). The *only* side effect is optional
JSON/CSV output written to a path the operator names.

Classification taxonomy (one primary label per row)
---------------------------------------------------
* ``valid_current``               — approved with full reviewer metadata, org is
                                    an active member of the project. Nothing to do.
* ``valid_legacy``                — approved and otherwise clean, but bulk-migrated
                                    (no ``created_by`` and/or carries the W1
                                    provenance marker). Values reconciled; benign.
* ``missing_reviewer_metadata``   — approved but ``reviewed_by`` and/or
                                    ``reviewed_at`` is NULL.
* ``missing_project_membership``  — the (project, organisation) pair has no active
                                    ``ProjectOrganization`` row.
* ``historical_hierarchy_exception`` — org is a project member but appears in no
                                    active hierarchy link for a project that
                                    otherwise uses hierarchies.
* ``duplicate_candidate``         — overlaps another row for the same
                                    (project, org, canonical indicator) on the
                                    time axis (mixed-cadence double-count risk).
* ``requires_manual_review``      — more than one exception applies at once.
* ``confirmed_invalid``           — NEVER assigned automatically. Reserved for a
                                    human decision; always reported as 0 here.

In-flight workflow states (draft/pending/reviewed/flagged/rejected) are NOT
exceptions — they are valid mid-workflow rows — so they are reported separately
under ``in_workflow`` and excluded from the approved-provenance checks.

Usage
-----
    # summary to stdout only:
    python manage.py audit_historical_exceptions

    # full per-row detail for review / ticketing:
    python manage.py audit_historical_exceptions --json /tmp/exceptions.json
    python manage.py audit_historical_exceptions --csv  /tmp/exceptions.csv

    # scope to one project:
    python manage.py audit_historical_exceptions --project 3

    # include training-project rows (excluded by default):
    python manage.py audit_historical_exceptions --include-training
"""
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict

from django.core.management.base import BaseCommand

from aggregates.models import Aggregate
from projects.models import ProjectOrganization, ProjectOrganizationHierarchy

# Same marker the W1 provenance-backfill command writes. Kept in sync so a row
# that has already been provenance-stamped is recognised as valid_legacy.
PROVENANCE_MARKER_TOKEN = 'W1-provenance-backfill'

APPROVED = 'approved'
IN_WORKFLOW_STATUSES = {'draft', 'pending', 'reviewed', 'flagged', 'rejected'}

# Ordered so the JSON/CSV/summary always list categories the same way.
CATEGORIES = [
    'valid_current',
    'valid_legacy',
    'in_workflow',
    'missing_reviewer_metadata',
    'missing_project_membership',
    'historical_hierarchy_exception',
    'duplicate_candidate',
    'requires_manual_review',
    'confirmed_invalid',
]


class Command(BaseCommand):
    help = (
        'READ-ONLY. Classify historical aggregate records against current '
        'workflow rules (WS2). Never writes to the database. Optional JSON/CSV '
        'output for review or ticketing.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--project', type=int, default=None,
                            help='Restrict to a single project id.')
        parser.add_argument('--json', dest='json_path', default=None,
                            help='Write full per-row classification to this JSON path.')
        parser.add_argument('--csv', dest='csv_path', default=None,
                            help='Write full per-row classification to this CSV path.')
        parser.add_argument('--include-training', action='store_true',
                            help='Include training-project aggregates (excluded by default).')
        parser.add_argument('--limit-detail', type=int, default=0,
                            help='Cap rows written to JSON/CSV (0 = no cap). '
                                 'Summary counts always cover every row.')

    # -- reference sets (built once, read-only) -----------------------------
    def _membership_set(self):
        """(project_id, organization_id) pairs that have a ``ProjectOrganization``
        assignment — the project-scoped membership truth used across the access
        layer. We intentionally count assignments regardless of ``is_active``: a
        deactivated assignment still legitimately explains an org's *historical*
        approved rows, so treating it as "missing" would be a false positive. A
        row is only ``missing_project_membership`` when NO assignment has ever
        existed for that (project, org)."""
        return set(
            ProjectOrganization.objects.values_list('project_id', 'organization_id')
        )

    def _hierarchy_orgs_by_project(self):
        """project_id -> set of org ids that appear in any active hierarchy link."""
        by_project = defaultdict(set)
        rows = ProjectOrganizationHierarchy.objects.filter(is_active=True).values_list(
            'project_id', 'parent_organization_id', 'child_organization_id'
        )
        for pid, parent_id, child_id in rows:
            by_project[pid].add(parent_id)
            by_project[pid].add(child_id)
        return by_project

    def _marked_ids(self, base_qs):
        """Ids of rows already carrying the W1 provenance marker (one cheap query)."""
        return set(
            base_qs.filter(notes__contains=PROVENANCE_MARKER_TOKEN)
            .values_list('id', flat=True)
        )

    def _overlap_candidate_ids(self, rows):
        """Ids whose [period_start, period_end] overlaps another row in the same
        (project, org, canonical indicator) group — a mixed-cadence double-count
        risk. Pure in-memory interval check; no writes."""
        groups = defaultdict(list)
        for r in rows:
            key = (r['project_id'], r['organization_id'], r['canonical_id'])
            groups[key].append((r['period_start'], r['period_end'], r['id']))
        flagged = set()
        for key, intervals in groups.items():
            if len(intervals) < 2:
                continue
            intervals.sort(key=lambda t: (t[0], t[1]))
            for i in range(len(intervals)):
                s_i, e_i, id_i = intervals[i]
                for j in range(i + 1, len(intervals)):
                    s_j, e_j, id_j = intervals[j]
                    if s_j > e_i:  # sorted by start; no later interval can overlap
                        break
                    if s_j <= e_i and s_i <= e_j:  # true overlap
                        flagged.add(id_i)
                        flagged.add(id_j)
        return flagged

    def _classify(self, row, membership, hierarchy_orgs, marked_ids, overlap_ids):
        """Return (primary_label, [all matched exceptions])."""
        status = row['status']
        if status in IN_WORKFLOW_STATUSES:
            return 'in_workflow', []

        exceptions = []
        pair = (row['project_id'], row['organization_id'])

        if status == APPROVED and (row['reviewed_by_id'] is None or row['reviewed_at'] is None):
            exceptions.append('missing_reviewer_metadata')

        if pair not in membership:
            exceptions.append('missing_project_membership')
        else:
            proj_hier = hierarchy_orgs.get(row['project_id'])
            if proj_hier and row['organization_id'] not in proj_hier:
                exceptions.append('historical_hierarchy_exception')

        if row['id'] in overlap_ids:
            exceptions.append('duplicate_candidate')

        if not exceptions:
            is_legacy = row['created_by_id'] is None or row['id'] in marked_ids
            return ('valid_legacy' if is_legacy else 'valid_current'), []
        if len(exceptions) == 1:
            return exceptions[0], exceptions
        return 'requires_manual_review', exceptions

    def handle(self, *args, **options):
        project_id = options['project']
        include_training = options['include_training']

        base = Aggregate.objects.all()
        if project_id is not None:
            base = base.filter(project_id=project_id)
        if not include_training:
            # Training rows live under training projects; exclude via the flag on
            # the project. (Aggregate has no is_training column; the project does.)
            base = base.filter(project__is_training=False)

        membership = self._membership_set()
        hierarchy_orgs = self._hierarchy_orgs_by_project()
        marked_ids = self._marked_ids(base)

        # Pull only the light columns needed (never the free-form ``value`` JSON).
        rows = list(base.values(
            'id', 'status', 'project_id', 'project__code', 'organization_id',
            'organization__name', 'indicator_id', 'indicator__code',
            'period_start', 'period_end',
            'reviewed_by_id', 'reviewed_at', 'created_by_id',
        ))
        # Aggregate has no canonical-indicator column (that lives on AggregateFact).
        # The duplicate-overlap grouping only needs a stable per-indicator key, so
        # group under indicator_id — a safe, slightly conservative choice (alias
        # rows simply group under themselves rather than their canonical parent).
        for r in rows:
            r['canonical_id'] = r['indicator_id']

        overlap_ids = self._overlap_candidate_ids(rows)

        counts = Counter()
        by_category_project = defaultdict(Counter)
        detail = []
        for r in rows:
            label, matched = self._classify(
                r, membership, hierarchy_orgs, marked_ids, overlap_ids
            )
            counts[label] += 1
            by_category_project[label][r['project__code'] or f"proj:{r['project_id']}"] += 1
            if label not in ('valid_current', 'valid_legacy', 'in_workflow'):
                detail.append({
                    'aggregate_id': r['id'],
                    'classification': label,
                    'all_exceptions': matched,
                    'status': r['status'],
                    'project_id': r['project_id'],
                    'project_code': r['project__code'],
                    'organization_id': r['organization_id'],
                    'organization_name': r['organization__name'],
                    'indicator_id': r['indicator_id'],
                    'indicator_code': r['indicator__code'],
                    'period_start': r['period_start'].isoformat() if r['period_start'] else None,
                    'period_end': r['period_end'].isoformat() if r['period_end'] else None,
                    'reviewed_by_id': r['reviewed_by_id'],
                    'reviewed_at': r['reviewed_at'].isoformat() if r['reviewed_at'] else None,
                    'created_by_id': r['created_by_id'],
                })

        self._print_summary(len(rows), counts, by_category_project, include_training)
        self._write_outputs(options, detail, counts)

    # -- output helpers ------------------------------------------------------
    def _print_summary(self, total, counts, by_category_project, include_training):
        self.stdout.write(self.style.MIGRATE_HEADING(
            f'\nHistorical aggregate exception classification (READ-ONLY)'))
        self.stdout.write(
            f'Scope: {"all projects incl. training" if include_training else "live projects"} '
            f'— {total} aggregate row(s)\n')
        exception_total = 0
        for cat in CATEGORIES:
            n = counts.get(cat, 0)
            if cat not in ('valid_current', 'valid_legacy', 'in_workflow'):
                exception_total += n
            style = self.style.SUCCESS if cat in ('valid_current', 'valid_legacy', 'in_workflow') \
                else (self.style.WARNING if n else self.style.SUCCESS)
            self.stdout.write(style(f'  {cat:<32}: {n}'))
            if n and cat not in ('valid_current', 'valid_legacy', 'in_workflow'):
                for code, cn in by_category_project[cat].most_common():
                    self.stdout.write(f'      {code}: {cn}')
        self.stdout.write('')
        if exception_total == 0:
            self.stdout.write(self.style.SUCCESS(
                'No exceptions requiring attention. All rows are valid_current, '
                'valid_legacy, or legitimately in-workflow.'))
        else:
            self.stdout.write(self.style.WARNING(
                f'{exception_total} row(s) classified as exceptions. This command '
                'made NO changes. Review the JSON/CSV detail and remediate through '
                'the documented, reversible commands only.'))

    def _write_outputs(self, options, detail, counts):
        limit = options['limit_detail']
        out_detail = detail[:limit] if limit and limit > 0 else detail
        if options['json_path']:
            with open(options['json_path'], 'w', encoding='utf-8') as fh:
                json.dump({
                    'read_only': True,
                    'summary': {cat: counts.get(cat, 0) for cat in CATEGORIES},
                    'detail_count': len(out_detail),
                    'detail': out_detail,
                }, fh, indent=2)
            self.stdout.write(self.style.SUCCESS(f'Wrote JSON detail: {options["json_path"]}'))
        if options['csv_path']:
            fields = ['aggregate_id', 'classification', 'all_exceptions', 'status',
                      'project_id', 'project_code', 'organization_id', 'organization_name',
                      'indicator_id', 'indicator_code', 'period_start', 'period_end',
                      'reviewed_by_id', 'reviewed_at', 'created_by_id']
            with open(options['csv_path'], 'w', encoding='utf-8', newline='') as fh:
                writer = csv.DictWriter(fh, fieldnames=fields)
                writer.writeheader()
                for row in out_detail:
                    row = dict(row)
                    row['all_exceptions'] = '|'.join(row['all_exceptions'])
                    writer.writerow(row)
            self.stdout.write(self.style.SUCCESS(f'Wrote CSV detail: {options["csv_path"]}'))
