"""Compose the "What needs you" home action counts (scope-safe).

Assembles a small set of role-relevant action items from existing sources — the
aggregate review queue, open reporting windows, and unresolved flags — each
scoped to the caller EXACTLY as its own module scopes it (org subtree, project
assignment, live/training mode). Returns counts + minimal context only; the
frontend owns labels, icons and deep-link hrefs (so wording and training-mode
href rewriting stay a frontend concern). Read-only; never widens visibility.

Each card returns None when it does not apply to the user or its count is zero,
and any card whose source errors is simply omitted — a broken source can never
break the home page.
"""
from __future__ import annotations

from datetime import timedelta

from django.db import DatabaseError
from django.utils import timezone

from aggregates.models import Aggregate, ReportingPeriod
from flags.models import Flag
from organizations.access import (
    apply_training_filter,
    can_approve_aggregates,
    can_review_aggregates,
    filter_queryset_by_org_ids,
    get_user_organization_ids,
    is_organization_admin,
)
from projects.scope import filter_queryset_by_assigned_projects

# How far ahead a reporting window counts as "closing soon" on the home page.
REPORTING_SOON_DAYS = 30


def _reviews_action(request, user):
    """Aggregates awaiting this user's review/approval, within their scope.

    Mirrors the aggregates viewset scope: training filter, project-assignment
    gate and org-subtree scope. Approvers (managers/admins) act on both pending
    and reviewed rows; officers on pending only.
    """
    if not can_review_aggregates(user):
        return None
    try:
        qs = apply_training_filter(Aggregate.objects.all(), request, project_lookup="project")
        if not is_organization_admin(user):
            qs = filter_queryset_by_assigned_projects(qs, user, "project_id")
            org_ids = get_user_organization_ids(user)
            qs = filter_queryset_by_org_ids(qs, "organization_id", org_ids) if org_ids else qs.none()
        statuses = ["pending", "reviewed"] if can_approve_aggregates(user) else ["pending"]
        count = qs.filter(status__in=statuses).count()
    except DatabaseError:
        return None
    if count <= 0:
        return None
    return {"key": "reviews", "count": count, "severity": "warning"}


def _flags_action(request, user):
    """Unresolved flags in this user's scope (mirrors FlagViewSet.get_queryset)."""
    # Deferred import: flags.views is a view module — import inside the function
    # to avoid any import-time coupling between the analysis and flags apps.
    from flags.views import apply_flag_project_gate, apply_flag_training_filter

    try:
        if is_organization_admin(user):
            qs = Flag.objects.all()
        else:
            org_ids = get_user_organization_ids(user)
            qs = (
                filter_queryset_by_org_ids(Flag.objects.all(), "organization_id", org_ids)
                if org_ids
                else Flag.objects.filter(created_by=user)
            )
        qs = apply_flag_training_filter(qs, request)
        qs = apply_flag_project_gate(qs, request)
        count = qs.filter(status__in=["open", "in_progress"]).count()
    except DatabaseError:
        return None
    if count <= 0:
        return None
    return {"key": "flags", "count": count, "severity": "warning"}


def _reporting_window_action(request, project):
    """Open reporting window(s) for the current project closing soon."""
    if project is None:
        return None
    now = timezone.now()
    soon = now + timedelta(days=REPORTING_SOON_DAYS)
    try:
        periods = list(
            ReportingPeriod.objects.filter(
                project=project,
                status=ReportingPeriod.STATUS_OPEN,
                submission_closes__isnull=False,
                submission_closes__gte=now,
                submission_closes__lte=soon,
            ).order_by("submission_closes")
        )
    except DatabaseError:
        return None
    if not periods:
        return None
    nearest = periods[0]
    closes_in_days = max((nearest.submission_closes - now).days, 0)
    severity = "critical" if closes_in_days <= 3 else "warning"
    return {
        "key": "reporting_window",
        "count": len(periods),
        "severity": severity,
        "context": {
            "quarter": nearest.quarter,
            "fiscal_year": nearest.fiscal_year,
            "closes_in_days": closes_in_days,
            "closes_on": nearest.submission_closes.date().isoformat(),
        },
    }


def build_home_actions(request, project) -> list[dict]:
    """The ordered list of applicable action cards for the caller (may be empty)."""
    user = request.user
    candidates = [
        _reviews_action(request, user),
        _reporting_window_action(request, project),
        _flags_action(request, user),
    ]
    return [card for card in candidates if card is not None]
