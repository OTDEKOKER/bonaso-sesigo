"""Shared DRF filter backends.

`StableOrderingFilter` guarantees deterministic pagination. Ordering a queryset
by a non-unique column (e.g. ``-created_at`` or ``-period_start``) leaves the
order of tied rows undefined, so the database is free to return them in a
different order for each ``LIMIT/OFFSET`` page. That makes rows silently jump,
duplicate, or disappear between pages. Appending the primary key as a final
tie-breaker makes the total order strict and therefore stable across pages,
whether the ordering came from the ``?ordering=`` query param or a view default.
"""

from rest_framework.filters import OrderingFilter


class StableOrderingFilter(OrderingFilter):
    """OrderingFilter that always appends the primary key as a tie-breaker."""

    def get_ordering(self, request, queryset, view):
        ordering = super().get_ordering(request, queryset, view)
        if not ordering:
            # No ordering resolved here; the model's Meta.ordering governs and is
            # responsible for its own tie-breaker.
            return ordering
        ordering = list(ordering)
        if not any(field.lstrip('-') in ('pk', 'id') for field in ordering):
            ordering.append('pk')
        return ordering
