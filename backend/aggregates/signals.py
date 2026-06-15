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
