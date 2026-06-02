"""
Keep analysis.CoordinatorTarget in sync with projects.ProjectIndicatorOrganizationTarget.

ProjectIndicatorOrganizationTarget (POT) stores one row per (project_indicator,
organization) with q1..q4 columns. CoordinatorTarget (CT) — the model behind the
"Coordinator Portfolio Targets" page — stores one row per
(project, coordinator, indicator, year, quarter).

On every POT save we upsert the 4 matching CT quarter-rows; on POT delete we
deactivate them. CT has no reverse signal, so there is no update loop.
"""
import logging

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import ProjectIndicatorOrganizationTarget

logger = logging.getLogger(__name__)
QUARTERS = ('Q1', 'Q2', 'Q3', 'Q4')


def target_year_for_project(project) -> int:
    """CoordinatorTarget.year = the project's financial-year start year."""
    start = getattr(project, 'start_date', None)
    return start.year if start else timezone.now().year


def sync_pot_to_coordinator_targets(pot, *, active=True):
    """Upsert the 4 CoordinatorTarget quarter-rows that mirror a POT row."""
    from analysis.models import CoordinatorTarget
    pi = pot.project_indicator
    project = pi.project
    year = target_year_for_project(project)
    quarter_values = {
        'Q1': pot.q1_target, 'Q2': pot.q2_target,
        'Q3': pot.q3_target, 'Q4': pot.q4_target,
    }
    for quarter in QUARTERS:
        CoordinatorTarget.objects.update_or_create(
            project_id=project.id,
            coordinator_id=pot.organization_id,
            indicator_id=pi.indicator_id,
            year=year,
            quarter=quarter,
            defaults={'target_value': quarter_values[quarter] or 0, 'is_active': active},
        )


@receiver(post_save, sender=ProjectIndicatorOrganizationTarget, dispatch_uid='pot_to_coordinator_target_save')
def _pot_saved(sender, instance, **kwargs):
    try:
        sync_pot_to_coordinator_targets(instance, active=True)
    except Exception:  # never let target sync break a POT write
        logger.exception('POT -> CoordinatorTarget sync failed for POT id=%s', getattr(instance, 'id', None))


@receiver(post_delete, sender=ProjectIndicatorOrganizationTarget, dispatch_uid='pot_to_coordinator_target_delete')
def _pot_deleted(sender, instance, **kwargs):
    try:
        from analysis.models import CoordinatorTarget
        pi = instance.project_indicator
        year = target_year_for_project(pi.project)
        CoordinatorTarget.objects.filter(
            project_id=pi.project_id,
            coordinator_id=instance.organization_id,
            indicator_id=pi.indicator_id,
            year=year,
        ).update(is_active=False)
    except Exception:
        logger.exception('POT delete -> CoordinatorTarget deactivate failed for POT id=%s', getattr(instance, 'id', None))
