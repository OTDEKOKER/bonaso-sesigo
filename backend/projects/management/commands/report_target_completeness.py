"""Read-only target-completeness validation report (certification audit H5 / Phase 5).

For a project, cross-checks each coordinator's *reportable* indicators (those
placed on its active WorkbookLayout — the reporting contract) against the
coordinator targets that exist, and reports:

  * missing   — placed on the workbook but has NO target for the period
  * zero      — a target row exists but its value is 0 (effectively no target)
  * orphan    — a target exists for an indicator NOT placed on the workbook
  * duplicate — more than one target row for the same (coordinator, indicator, period)

It writes NOTHING to the database and modifies no production data. Output is a
CSV under ``reports/`` plus a printed summary, so it is safe to run against live.

Usage::

    python manage.py report_target_completeness --project 3 --year 2026 --quarters Q1,Q2,Q3,Q4
    python manage.py report_target_completeness --project 3            # all periods that have targets
"""
from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from analysis.models import CoordinatorTarget
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectOrganization, WorkbookLayout


def _canonical(indicator_id, cache):
    if indicator_id is None:
        return None
    if indicator_id not in cache:
        ind = Indicator.objects.filter(id=indicator_id).only(
            'id', 'canonical_indicator_id'
        ).first()
        cache[indicator_id] = ind.canonical_id if ind is not None else indicator_id
    return cache[indicator_id]


class Command(BaseCommand):
    help = "Report workbook-vs-target completeness for a project (read-only)."

    def add_arguments(self, parser):
        parser.add_argument('--project', required=True, type=int, help='Project id.')
        parser.add_argument('--year', type=int, default=None,
                            help='Fiscal start year to check (default: every period that has targets).')
        parser.add_argument('--quarters', default='Q1,Q2,Q3,Q4',
                            help='Comma list of quarters to require when --year is given.')
        parser.add_argument('--mode', default='live', choices=['live', 'training'],
                            help='Which workbook layouts to read (default: live).')

    def handle(self, *args, **opts):
        project = Project.objects.filter(id=opts['project']).first()
        if project is None:
            raise CommandError(f"Project {opts['project']} not found.")
        mode = opts['mode']
        canon_cache: dict = {}

        # Coordinators of this project (those that own a reporting workbook layout).
        coordinator_ids = list(
            ProjectOrganization.objects.filter(
                project=project, is_coordinator=True, is_active=True,
            ).values_list('organization_id', flat=True)
        )
        org_names = dict(Organization.objects.filter(id__in=coordinator_ids).values_list('id', 'name'))

        # Placed (reportable) canonical indicators per coordinator, from the active layout.
        placed: dict[int, set] = {}
        for coord_id in coordinator_ids:
            layout = (
                WorkbookLayout.objects.filter(
                    coordinator_organization_id=coord_id, mode=mode, is_active=True,
                ).prefetch_related('items').first()
            )
            if layout is None:
                placed[coord_id] = set()
                continue
            placed[coord_id] = {
                _canonical(item.indicator_id, canon_cache)
                for item in layout.items.all()
                if item.indicator_id is not None
            }

        # Existing coordinator targets for this project, keyed by canonical indicator.
        targets = defaultdict(list)  # (coord_id, canon, year, quarter) -> [target_value,...]
        tq = CoordinatorTarget.objects.filter(project=project)
        if opts['year'] is not None:
            tq = tq.filter(year=opts['year'])
        for t in tq.only('coordinator_id', 'indicator_id', 'year', 'quarter', 'target_value'):
            canon = _canonical(t.indicator_id, canon_cache)
            targets[(t.coordinator_id, canon, t.year, t.quarter)].append(float(t.target_value or 0))

        required_quarters = [q.strip().upper() for q in opts['quarters'].split(',') if q.strip()]
        rows = []

        # Determine the period set to check.
        if opts['year'] is not None:
            periods = [(opts['year'], q) for q in required_quarters]
        else:
            periods = sorted({(y, q) for (_c, _i, y, q) in targets.keys()})

        # 1) Missing / zero / duplicate for placed indicators.
        ind_names = dict(
            Indicator.objects.filter(id__in={c for c in canon_cache.values() if c})
            .values_list('id', 'name')
        )
        for coord_id in coordinator_ids:
            for canon in sorted(placed.get(coord_id, set()), key=lambda c: (c is None, c)):
                for (year, quarter) in periods:
                    vals = targets.get((coord_id, canon, year, quarter), [])
                    if not vals:
                        classification = 'missing'
                    elif len(vals) > 1:
                        classification = 'duplicate'
                    elif vals[0] == 0:
                        classification = 'zero'
                    else:
                        classification = 'ok'
                    if classification == 'ok':
                        continue
                    rows.append({
                        'coordinator_id': coord_id,
                        'coordinator': org_names.get(coord_id, str(coord_id)),
                        'canonical_indicator_id': canon,
                        'indicator': ind_names.get(canon, str(canon)),
                        'year': year, 'quarter': quarter,
                        'target_count': len(vals),
                        'target_value': vals[0] if vals else '',
                        'classification': classification,
                    })

        # 2) Orphan targets — a target exists for an indicator NOT placed on the workbook.
        for (coord_id, canon, year, quarter), vals in targets.items():
            if coord_id not in placed:
                continue  # not a coordinator of this project (defensive)
            if canon in placed.get(coord_id, set()):
                continue
            rows.append({
                'coordinator_id': coord_id,
                'coordinator': org_names.get(coord_id, str(coord_id)),
                'canonical_indicator_id': canon,
                'indicator': ind_names.get(canon, str(canon)),
                'year': year, 'quarter': quarter,
                'target_count': len(vals),
                'target_value': vals[0] if vals else '',
                'classification': 'orphan',
            })

        # Write CSV.
        out_dir = Path(settings.BASE_DIR) / 'reports'
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        out_path = out_dir / f'target_completeness_p{project.id}_{stamp}.csv'
        fieldnames = ['coordinator_id', 'coordinator', 'canonical_indicator_id', 'indicator',
                      'year', 'quarter', 'target_count', 'target_value', 'classification']
        with out_path.open('w', newline='', encoding='utf-8') as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            for row in sorted(rows, key=lambda r: (r['classification'], r['coordinator'], str(r['indicator']))):
                writer.writerow(row)

        counts = defaultdict(int)
        for row in rows:
            counts[row['classification']] += 1
        self.stdout.write(self.style.SUCCESS(
            f"Target completeness for project {project.code} ({project.name}):"
        ))
        for key in ('missing', 'zero', 'duplicate', 'orphan'):
            self.stdout.write(f"  {key:9}: {counts.get(key, 0)}")
        self.stdout.write(f"Report written to {out_path}")
