"""
Offline sync-down package for field data capture (DHIS2 Tracker Capture style).

A single authenticated endpoint that returns everything a field worker needs to
work fully offline for their assigned scope, in one round trip:

    profile, assigned project(s), assigned organisation, coordinator
    organisation, allowed sub-grantees, assigned indicators, assigned forms
    (disaggregation/validation rules), target groups, districts/localities,
    reporting periods, and the respondents already assigned to the user/org.

The response is scoped to the caller's organisation (and its descendants) and
honours the Sesigo training/live boundary, so a training session downloads only
training data and a live session only live data.
"""
from __future__ import annotations

from datetime import date

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from organizations.access import (
    get_user_organization_ids,
    is_organization_admin,
    apply_training_filter_to_projects,
    training_view_mode,
)


def _quarter_periods(start: date, end: date):
    """Financial-year-agnostic calendar quarters spanning [start, end]."""
    periods = []
    if not start or not end or end < start:
        return periods
    y = start.year
    q_start_month = ((start.month - 1) // 3) * 3 + 1
    cursor = date(y, q_start_month, 1)
    while cursor <= end:
        q = (cursor.month - 1) // 3 + 1
        last_month = cursor.month + 2
        last_year = cursor.year + (1 if last_month > 12 else 0)
        last_month = last_month - 12 if last_month > 12 else last_month
        # last day of the quarter's final month
        if last_month == 12:
            period_end = date(last_year, 12, 31)
        else:
            period_end = date(last_year, last_month + 1, 1).toordinal() - 1
            period_end = date.fromordinal(period_end)
        periods.append({
            "label": f"{cursor.year}-Q{q}",
            "start": cursor.isoformat(),
            "end": period_end.isoformat(),
        })
        # advance one quarter
        nm = cursor.month + 3
        ny = cursor.year + (1 if nm > 12 else 0)
        nm = nm - 12 if nm > 12 else nm
        cursor = date(ny, nm, 1)
    return periods


class OfflineBootstrapView(APIView):
    """GET /api/offline/bootstrap/ -> the caller's offline data package."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from projects.models import (
            Project, ProjectIndicator, ProjectOrganization,
            ProjectIndicatorDisaggregationRule,
        )
        from organizations.models import Organization
        from respondents.models import Respondent

        user = request.user
        mode = training_view_mode(request)
        is_admin = is_organization_admin(user)
        org_ids = get_user_organization_ids(user)
        own_org = user.organization

        # --- Projects in scope (mode-aware) ---------------------------------
        projects_qs = Project.objects.all()
        if not is_admin:
            if org_ids:
                projects_qs = projects_qs.filter(organizations__id__in=org_ids).distinct()
            else:
                projects_qs = projects_qs.none()
        projects_qs = apply_training_filter_to_projects(projects_qs, request)
        project_ids = list(projects_qs.values_list("id", flat=True))

        projects = [
            {
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "status": p.status,
                "start_date": p.start_date.isoformat() if p.start_date else None,
                "end_date": p.end_date.isoformat() if p.end_date else None,
                "is_training": p.is_training,
                "reporting_periods": _quarter_periods(p.start_date, p.end_date),
            }
            for p in projects_qs
        ]

        # --- Project-organisation assignments (roles, districts, hierarchy) -
        po_qs = ProjectOrganization.objects.filter(
            project_id__in=project_ids
        ).select_related("organization", "parent_assignment")
        if not is_admin and org_ids:
            # the worker's own org + its parents/children within these projects
            po_qs = po_qs.filter(organization_id__in=org_ids)

        assignments = []
        coordinator_orgs = {}
        sub_grantees = {}
        district_set, locality_set, target_group_set = set(), set(), set()
        for po in po_qs:
            assignments.append({
                "project_id": po.project_id,
                "organization_id": po.organization_id,
                "organization_name": po.organization.name,
                "role": po.role,
                "is_coordinator": po.is_coordinator,
                "is_sub_grantee": po.is_sub_grantee,
                "is_implementer": po.is_implementer,
                "can_report_indicators": po.can_report_indicators,
                "parent_assignment_id": po.parent_assignment_id,
                "districts": po.districts or [],
                "localities": po.localities or [],
            })
            for d in (po.districts or []):
                district_set.add(d)
            for loc in (po.localities or []):
                locality_set.add(loc)

        # Coordinator org for the worker's assignments + allowed sub-grantees.
        if own_org is not None:
            parent = own_org.parent
            if parent is not None:
                coordinator_orgs[parent.id] = {
                    "id": parent.id, "code": parent.code, "name": parent.name, "type": parent.type,
                }
            for child in own_org.get_descendants():
                sub_grantees[child.id] = {
                    "id": child.id, "code": child.code, "name": child.name, "type": child.type,
                }

        # --- Indicators assigned to these projects + forms/validation -------
        pi_qs = ProjectIndicator.objects.filter(
            project_id__in=project_ids
        ).select_related("indicator")
        indicators = []
        for pi in pi_qs:
            ind = pi.indicator
            if pi.target_group:
                target_group_set.add(pi.target_group)
            indicators.append({
                "project_indicator_id": pi.id,
                "project_id": pi.project_id,
                "indicator_id": ind.id,
                "code": ind.code,
                "name": ind.name,
                "target_group": pi.target_group,
                "aggregate_disaggregation_config": getattr(ind, "aggregate_disaggregation_config", {}) or {},
            })

        # "Forms" = the disaggregation/validation rules for these assignments.
        rule_qs = ProjectIndicatorDisaggregationRule.objects.filter(
            project_indicator__project_id__in=project_ids
        )
        forms = [
            {
                "id": r.id,
                "project_indicator_id": r.project_indicator_id,
                "organization_id": r.organization_id,
                "dimension_key": r.dimension_key,
                "display_label": r.display_label,
                "is_required": r.is_required,
                "is_active": r.is_active,
                "sort_order": r.sort_order,
                "config": r.config or {},
            }
            for r in rule_qs.filter(is_active=True)
        ]

        # --- Respondents already assigned to this user / org ----------------
        resp_qs = Respondent.objects.all()
        if not is_admin:
            from django.db.models import Q
            scope = Q(created_by=user)
            if org_ids:
                scope |= Q(organization_id__in=org_ids)
            resp_qs = resp_qs.filter(scope)
        respondents = [
            {
                "id": obj.id,
                "organization_id": obj.organization_id,
                "created_by_id": obj.created_by_id,
                "label": str(obj),
            }
            for obj in resp_qs.order_by("id")[:5000]
        ]

        package = {
            "downloaded_at": timezone.now().isoformat(),
            "mode": mode,
            "profile": {
                "id": user.id,
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "email": user.email,
                "role": user.role,
                "organization_id": user.organization_id,
                "is_admin": is_admin,
            },
            "organization": (
                {"id": own_org.id, "code": own_org.code, "name": own_org.name, "type": own_org.type}
                if own_org else None
            ),
            "coordinator_organizations": list(coordinator_orgs.values()),
            "sub_grantees": list(sub_grantees.values()),
            "projects": projects,
            "assignments": assignments,
            "indicators": indicators,
            "forms": forms,
            "target_groups": sorted(target_group_set),
            "districts": sorted(district_set),
            "localities": sorted(locality_set),
            "respondents": respondents,
            "counts": {
                "projects": len(projects),
                "indicators": len(indicators),
                "forms": len(forms),
                "respondents": len(respondents),
            },
        }
        return Response(package)
