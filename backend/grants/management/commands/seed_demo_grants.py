"""Seed realistic demo grant data for a walkthrough / director demo.

Safe by default: creates a TRAINING project + demo organizations (linked only to
that training project, so they stay out of live lists) and a spread of grants
with green / amber / over-budget burn rates. Idempotent by grant code.

    python manage.py seed_demo_grants                 # into a training demo project
    python manage.py seed_demo_grants --project 3     # into an existing (e.g. live) project

Nothing is deployed by this; it only writes rows to whatever DB you run it on.
"""
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from grants.models import Grant, GrantBudgetLine, GrantDisbursement, GrantExpenditure
from organizations.models import Organization
from projects.models import Project

# org name, code, awarded, disbursed, spent  (spent drives the burn colour)
DEMO = [
    ("MBGE",       "DEMO-MBGE", "1200000", "900000", "1320000"),  # 110% over budget (red)
    ("BONELA",     "DEMO-BON",   "800000", "800000",  "760000"),  # 95%  near limit (amber)
    ("TEBELOPELE", "DEMO-TEB",   "650000", "400000",  "300000"),  # 46%  within budget (green)
    ("BOCHAIP",    "DEMO-BOC",   "500000", "250000",  "180000"),  # 36%  within budget (green)
]


class Command(BaseCommand):
    help = "Seed demo grant data (training project by default)."

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, default=None,
                            help="Existing project id to seed into (default: a training demo project).")

    @transaction.atomic
    def handle(self, *args, **options):
        project_id = options.get("project")
        if project_id:
            project = Project.objects.get(id=project_id)
        else:
            project, _ = Project.objects.get_or_create(
                code="DEMO-GRANTS",
                defaults=dict(
                    name="Grants Demo (Training)", status="active", is_training=True,
                    start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
                ),
            )
        self.stdout.write(f"Seeding grants into project #{project.id} ({project.name}).")

        for name, code, awarded, disbursed, spent in DEMO:
            org, _ = Organization.objects.get_or_create(
                code=f"{code}-ORG", defaults=dict(name=name, type="ngo"),
            )
            grant, created = Grant.objects.get_or_create(
                code=code, project=project, organization=org,
                defaults=dict(
                    title=f"{name} annual grant", currency="BWP",
                    total_amount=Decimal(awarded), status="active",
                    start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
                ),
            )
            if not created:
                continue
            GrantBudgetLine.objects.create(grant=grant, category="Personnel", budgeted_amount=Decimal(awarded) * Decimal("0.6"))
            GrantBudgetLine.objects.create(grant=grant, category="Activities", budgeted_amount=Decimal(awarded) * Decimal("0.4"))
            GrantDisbursement.objects.create(grant=grant, date=date(2026, 2, 1), tranche=1, amount=Decimal(disbursed))
            GrantExpenditure.objects.create(grant=grant, date=date(2026, 4, 30), category="Personnel", amount=Decimal(spent) * Decimal("0.7"))
            GrantExpenditure.objects.create(grant=grant, date=date(2026, 6, 30), category="Activities", amount=Decimal(spent) * Decimal("0.3"))

        self.stdout.write(self.style.SUCCESS(f"Done. {Grant.objects.filter(project=project).count()} grants in project."))
