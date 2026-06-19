"""Seed one demo project's worth of live data into the Training partition.

Clones a small, coherent slice of live project #2 ("NAHPA Social Contracting")
into training project #6 ("DEMO - Sesigo Training Project") so in-app Training
Mode dashboards/analysis look populated for live training.

Idempotent: re-running upserts on natural keys and never double-counts.
Set APPLY=1 in the environment to commit; otherwise it dry-runs and rolls back.
"""
import os
from django.db import transaction
from projects.models import (
    Project, ProjectIndicator, ProjectOrganization,
    ProjectIndicatorOrganizationTarget,
)
from aggregates.models import Aggregate

SRC = 2
DST = 6
ORG_IDS = [138, 144, 142]  # Nkaikela Youth Group, LEGABIBO, Madikwe Community Trust
APPLY = os.environ.get("APPLY") == "1"

dst_proj = Project.objects.get(id=DST)
assert dst_proj.is_training, "target project must be a training project"

src_aggs = Aggregate.objects.filter(project_id=SRC, organization_id__in=ORG_IDS)
ind_ids = set(src_aggs.values_list("indicator_id", flat=True))
print(f"source: project {SRC}, orgs {ORG_IDS}")
print(f"  aggregates to clone : {src_aggs.count()}")
print(f"  distinct indicators : {len(ind_ids)}")

new_aggs = 0
try:
    with transaction.atomic():
        # 1. Project<->org membership (M2M + ProjectOrganization rows)
        dst_proj.organizations.add(*ORG_IDS)
        for spo in ProjectOrganization.objects.filter(project_id=SRC, organization_id__in=ORG_IDS):
            ProjectOrganization.objects.get_or_create(
                project=dst_proj, organization_id=spo.organization_id,
                defaults=dict(
                    role=spo.role, is_coordinator=spo.is_coordinator,
                    is_sub_grantee=spo.is_sub_grantee, is_implementer=spo.is_implementer,
                    can_report_indicators=spo.can_report_indicators, cluster=spo.cluster,
                    thematic_areas=spo.thematic_areas, districts=spo.districts,
                    localities=spo.localities, is_training=True, is_active=True,
                ),
            )

        # 2. Project<->indicator links (clone targets)
        pi_map = {}
        for spi in ProjectIndicator.objects.filter(project_id=SRC, indicator_id__in=ind_ids):
            pi, _ = ProjectIndicator.objects.get_or_create(
                project=dst_proj, indicator_id=spi.indicator_id,
                defaults=dict(
                    target_group=spi.target_group, q1_target=spi.q1_target,
                    q2_target=spi.q2_target, q3_target=spi.q3_target,
                    q4_target=spi.q4_target, target_value=spi.target_value,
                    baseline_value=spi.baseline_value,
                ),
            )
            pi_map[spi.indicator_id] = pi

        # 3. Org-scoped quarterly targets
        for st in ProjectIndicatorOrganizationTarget.objects.filter(
            project_indicator__project_id=SRC,
            project_indicator__indicator_id__in=ind_ids,
            organization_id__in=ORG_IDS,
        ):
            dpi = pi_map.get(st.project_indicator.indicator_id)
            if dpi:
                ProjectIndicatorOrganizationTarget.objects.get_or_create(
                    project_indicator=dpi, organization_id=st.organization_id,
                    defaults=dict(
                        q1_target=st.q1_target, q2_target=st.q2_target,
                        q3_target=st.q3_target, q4_target=st.q4_target,
                        target_value=st.target_value,
                    ),
                )

        # 4. Aggregates (idempotent on the natural key; facts sync via signal)
        for a in src_aggs.iterator():
            _, created = Aggregate.objects.update_or_create(
                indicator_id=a.indicator_id, project=dst_proj,
                organization_id=a.organization_id,
                period_start=a.period_start, period_end=a.period_end,
                defaults=dict(value=a.value, status=a.status, notes=a.notes, created_by=None),
            )
            new_aggs += int(created)

        print(f"  aggregates newly created (this run): {new_aggs}")
        print(f"  project-indicator links now: {ProjectIndicator.objects.filter(project=dst_proj).count()}")
        print(f"  project-org rows now: {ProjectOrganization.objects.filter(project=dst_proj).count()}")
        if not APPLY:
            raise RuntimeError("DRY_RUN_ROLLBACK")
except RuntimeError as e:
    if str(e) != "DRY_RUN_ROLLBACK":
        raise
    print("\nDRY RUN — rolled back. Set APPLY=1 to commit.")
else:
    print("\nAPPLIED — committed.")
