"""
Two-way sync between projects.ProjectIndicatorOrganizationTarget (POT) and
analysis.CoordinatorTarget (CT).

POT stores one row per (project_indicator, organization) with q1..q4 columns.
CT — the model behind the "Coordinator Portfolio Targets" page — stores one row
per (project, coordinator, indicator, year, quarter).

- Saving/deleting a POT row upserts/deactivates the 4 matching CT quarter-rows.
- Saving a CT row writes its value back into the matching quarter column on POT
  (creating the ProjectIndicator/POT if needed) — but only for CT rows whose
  year matches the project's financial-year start year (POT is year-agnostic and
  represents the current FY).

A thread-local guard prevents the two signals from looping into each other.
All sync work is wrapped in try/except so it can never break the originating write.
"""
import logging
import threading

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import ProjectIndicator, ProjectIndicatorOrganizationTarget
from analysis.models import CoordinatorTarget

logger = logging.getLogger(__name__)
QUARTERS = ('Q1', 'Q2', 'Q3', 'Q4')
QUARTER_FIELD = {'Q1': 'q1_target', 'Q2': 'q2_target', 'Q3': 'q3_target', 'Q4': 'q4_target'}
_guard = threading.local()


def _syncing() -> bool:
    return getattr(_guard, 'active', False)


def target_year_for_project(project) -> int:
    """CoordinatorTarget.year = the project's financial-year start year."""
    start = getattr(project, 'start_date', None)
    return start.year if start else timezone.now().year


# --- POT -> CT ------------------------------------------------------------
def sync_pot_to_coordinator_targets(pot, *, active=True):
    pi = pot.project_indicator
    project = pi.project
    year = target_year_for_project(project)
    vals = {'Q1': pot.q1_target, 'Q2': pot.q2_target, 'Q3': pot.q3_target, 'Q4': pot.q4_target}
    for quarter in QUARTERS:
        CoordinatorTarget.objects.update_or_create(
            project_id=project.id, coordinator_id=pot.organization_id, indicator_id=pi.indicator_id,
            year=year, quarter=quarter,
            defaults={'target_value': vals[quarter] or 0, 'is_active': active},
        )


# --- CT -> POT ------------------------------------------------------------
def sync_coordinator_target_to_pot(ct):
    pi = ProjectIndicator.objects.filter(project_id=ct.project_id, indicator_id=ct.indicator_id).first()
    if pi is None:
        pi = ProjectIndicator.objects.create(project_id=ct.project_id, indicator_id=ct.indicator_id)
    # Only sync CT rows for the project's current financial year (POT is year-agnostic).
    if ct.year != target_year_for_project(pi.project):
        return
    pot, _ = ProjectIndicatorOrganizationTarget.objects.get_or_create(
        project_indicator=pi, organization_id=ct.coordinator_id)
    field = QUARTER_FIELD.get(ct.quarter)
    if not field:
        return
    setattr(pot, field, ct.target_value or 0)
    pot.target_value = (pot.q1_target or 0) + (pot.q2_target or 0) + (pot.q3_target or 0) + (pot.q4_target or 0)
    pot.save()


@receiver(post_save, sender=ProjectIndicatorOrganizationTarget, dispatch_uid='pot_to_ct_save')
def _pot_saved(sender, instance, **kwargs):
    if _syncing():
        return
    _guard.active = True
    try:
        sync_pot_to_coordinator_targets(instance, active=True)
    except Exception:
        logger.exception('POT -> CT sync failed for POT id=%s', getattr(instance, 'id', None))
    finally:
        _guard.active = False


@receiver(post_delete, sender=ProjectIndicatorOrganizationTarget, dispatch_uid='pot_to_ct_delete')
def _pot_deleted(sender, instance, **kwargs):
    if _syncing():
        return
    _guard.active = True
    try:
        pi = instance.project_indicator
        CoordinatorTarget.objects.filter(
            project_id=pi.project_id, coordinator_id=instance.organization_id,
            indicator_id=pi.indicator_id, year=target_year_for_project(pi.project),
        ).update(is_active=False)
    except Exception:
        logger.exception('POT delete -> CT deactivate failed for POT id=%s', getattr(instance, 'id', None))
    finally:
        _guard.active = False


@receiver(post_save, sender=CoordinatorTarget, dispatch_uid='ct_to_pot_save')
def _ct_saved(sender, instance, **kwargs):
    if _syncing():
        return
    _guard.active = True
    try:
        sync_coordinator_target_to_pot(instance)
    except Exception:
        logger.exception('CT -> POT sync failed for CT id=%s', getattr(instance, 'id', None))
    finally:
        _guard.active = False
