"""Reporting-history protection for destructive lifecycle operations.

Certification audit C1/H4: a Project, Indicator or Organisation that carries
reporting history must never be hard-deleted. Every ``Aggregate`` FK to these
models is ``on_delete=CASCADE`` (aggregates/models.py), so a single DELETE
silently destroys submitted reporting data — unrecoverable except from the last
nightly backup.

These helpers return a human-readable *block reason* (or ``None`` when deletion
is safe) so viewsets can refuse the delete with a clear ``409 Conflict`` and
steer the admin to the safe lifecycle action instead:

  * Projects       → archive (``status='archived'``)
  * Indicators     → retire (``is_active=False``) / deprecate
  * Organisations  → deactivate

Historical reporting data therefore stays permanently available. All model
imports are lazy so this module is import-safe from any app.
"""
from __future__ import annotations

# Any aggregate row — regardless of review status — is reporting history worth
# protecting: a pending/flagged submission is still an organisation's captured
# work, and an approved one is official. We intentionally do not narrow to
# ``status='approved'`` here.


def _aggregate_count(**filters) -> int:
    from aggregates.models import Aggregate

    return Aggregate.objects.filter(**filters).count()


def project_delete_block_reason(project) -> str | None:
    """Why ``project`` may not be hard-deleted, or ``None`` when it is safe."""
    if project is None or getattr(project, "pk", None) is None:
        return None
    count = _aggregate_count(project_id=project.pk)
    if count:
        return (
            f"This project has {count} reported record(s) and cannot be deleted. "
            "Archive the project instead (set status to 'archived') to preserve "
            "its reporting history."
        )
    return None


def indicator_delete_block_reason(indicator) -> str | None:
    """Why ``indicator`` may not be hard-deleted, or ``None`` when it is safe."""
    if indicator is None or getattr(indicator, "pk", None) is None:
        return None
    # Count history on this indicator and on any deprecated duplicates that fold
    # into it, so retiring a canonical never orphans a variant's history.
    from aggregates.models import Aggregate

    variant_ids = {indicator.pk}
    try:
        variant_ids |= set(
            indicator.deprecated_variants.values_list("id", flat=True)
        )
    except Exception:  # pragma: no cover - relation always present in practice
        pass
    count = Aggregate.objects.filter(indicator_id__in=variant_ids).count()
    if count:
        return (
            f"This indicator has {count} reported record(s) and cannot be "
            "deleted. Retire it instead (deactivate, or mark it deprecated) so "
            "historical reporting is preserved while it is hidden from new "
            "workbooks."
        )
    return None


def organization_delete_block_reason(organization) -> str | None:
    """Why ``organization`` may not be hard-deleted, or ``None`` when safe."""
    if organization is None or getattr(organization, "pk", None) is None:
        return None
    count = _aggregate_count(organization_id=organization.pk)
    if count:
        return (
            f"This organisation has {count} reported record(s) and cannot be "
            "deleted. Deactivate it instead to preserve its reporting history."
        )
    return None
