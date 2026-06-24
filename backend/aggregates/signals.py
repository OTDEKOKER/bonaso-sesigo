"""Keep the derived AggregateFact rows in sync with Aggregate writes.

A post_save rebuild covers create + update (and bulk paths that call .save()).
Deletes are handled by the AggregateFact.aggregate FK on_delete=CASCADE, so no
post_delete handler is needed. Failures are swallowed + logged: the fact table
is derived/rebuildable, so a sync hiccup must never break the primary write.
"""
from __future__ import annotations

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Aggregate

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Aggregate, dispatch_uid="aggregates_sync_facts")
def _sync_aggregate_facts(sender, instance, **kwargs):
    from .facts import sync_facts_for_aggregate

    def _run():
        try:
            sync_facts_for_aggregate(instance)
        except Exception:  # never let fact sync break the primary write
            logger.exception("AggregateFact sync failed for aggregate %s", instance.pk)

    # Run after the surrounding transaction commits so facts reflect the
    # persisted row (and we don't sync a row that may roll back).
    transaction.on_commit(_run)
    transaction.on_commit(lambda: _sync_coherence_flag(instance))


def _sync_coherence_flag(instance):
    """Real-time consistency check (Phase 1): raise/refresh a non-blocking
    consistency flag when the saved value's disaggregates disagree with its
    stated total, and auto-resolve it once the value becomes coherent. Never
    blocks the write; failures are swallowed (data quality must not break saves).
    """
    try:
        from . import data_quality as dq
        from .data_quality_checks import upsert_dq_flag
        from flags.models import Flag

        report = dq.coherence_report(instance.value)
        open_flag = next(
            (
                f for f in Flag.objects.filter(
                    flag_type="data_quality", content_type="aggregate",
                    object_id=instance.id, status="open",
                )
                if (f.metadata or {}).get("category") == dq.CATEGORY_CONSISTENCY
            ),
            None,
        )
        if report["checked"] and not report["is_coherent"]:
            upsert_dq_flag(
                category=dq.CATEGORY_CONSISTENCY, aggregate=instance, severity=report["severity"],
                title=f"Consistency: {instance.indicator.code or instance.indicator.name}",
                description=(
                    f"Reported total {report['reported_total']} ≠ calculated "
                    f"{report['calculated_total']} (difference {report['difference']})."
                ),
                details=report, run_label="realtime",
            )
        elif open_flag is not None:
            # Became coherent → auto-resolve the standing consistency flag.
            from django.utils import timezone
            open_flag.status = "resolved"
            open_flag.resolution_notes = "Auto-resolved: value is now internally consistent."
            open_flag.resolved_at = timezone.now()
            open_flag.save(update_fields=["status", "resolution_notes", "resolved_at", "updated_at"])
    except Exception:  # data quality must never break the primary write
        logger.exception("Coherence flag sync failed for aggregate %s", getattr(instance, "pk", None))
