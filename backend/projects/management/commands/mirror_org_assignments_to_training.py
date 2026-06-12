"""Mirror an organization's indicator assignments from a source (live) project
into a training project, so the SESIGO reporting workbook can be generated /
imported for that org inside the training sandbox.

Idempotent: re-running only fills gaps. Only writes to a project where
is_training=True (safety guard) unless --force is given.

Example:
    python manage.py mirror_org_assignments_to_training \
        --source-project-id 3 --target-project-id 4 --org-id 101
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organizations.models import Organization
from projects.models import (
    Project, ProjectIndicator, ProjectIndicatorAssignment, ProjectOrganization,
)
from projects.assignment_rules import get_assigned_indicator_ids_for_organization


class Command(BaseCommand):
    help = "Mirror an org's assigned indicators from a source project into a training project."

    def add_arguments(self, parser):
        parser.add_argument("--source-project-id", type=int, required=True)
        parser.add_argument("--target-project-id", type=int, required=True)
        parser.add_argument("--org-id", type=int, required=True)
        parser.add_argument("--force", action="store_true",
                            help="Allow a non-training target project.")

    @transaction.atomic
    def handle(self, *args, **o):
        source = Project.objects.get(id=o["source_project_id"])
        target = Project.objects.get(id=o["target_project_id"])
        org = Organization.objects.get(id=o["org_id"])

        if not target.is_training and not o["force"]:
            raise CommandError(
                f"Target project {target.id} ({target.code}) is not a training "
                f"project. Refusing without --force."
            )

        indicator_ids = list(get_assigned_indicator_ids_for_organization(
            project=source, organization_id=org.id))
        if not indicator_ids:
            raise CommandError(
                f"Org {org.id} ({org.name}) has no assigned indicators in source "
                f"project {source.id} ({source.code})."
            )

        # 1. Org membership in the target project.
        target.organizations.add(org)
        po, _ = ProjectOrganization.objects.get_or_create(project=target, organization=org)

        created_pi = created_assign = 0
        for ind_id in indicator_ids:
            pi, made = ProjectIndicator.objects.get_or_create(
                project=target, indicator_id=ind_id)
            created_pi += int(made)
            _, made_a = ProjectIndicatorAssignment.objects.get_or_create(
                project_indicator=pi, organization=org,
                defaults={
                    "project_organization": po,
                    "assignment_source": "manual",
                    "is_active": True,
                },
            )
            created_assign += int(made_a)

        # Verify the assignment resolver now sees them in the target.
        resolved = len(get_assigned_indicator_ids_for_organization(
            project=target, organization_id=org.id))

        self.stdout.write(self.style.SUCCESS(
            f"Mirrored {org.name} -> {target.code}: "
            f"{len(indicator_ids)} source indicators; "
            f"+{created_pi} ProjectIndicator, +{created_assign} assignments; "
            f"resolver now returns {resolved} for the org."
        ))
