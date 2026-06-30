"""API for coordinator-level Workbook Layouts.

A layout defines ONLY the indicator order (+ optional section headings) used when
generating reporting workbooks. It is project/period independent — see
``projects.workbook_layout`` for how it is applied at download time.

Permissions (enforced server-side, not just hidden in the UI):
  * Admin / M&E Manager  → create + edit layouts for any coordinator.
  * Coordinator users    → create + edit only their OWN coordinator's layout
                           (a user whose organization is the coordinator org).
  * Everyone else (sub-grantee / officer / collector / client) → read-only;
    they merely consume the layout when downloading a workbook.

Layouts are also Live/Training isolated: the queryset and every write are bound
to the request's environment via the signed JWT ``mode`` claim.
"""
from __future__ import annotations

from django.db import IntegrityError, transaction
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


class WorkbookLayoutConflict(APIException):
    """Raised when a save would clobber a newer version edited elsewhere."""
    status_code = status.HTTP_409_CONFLICT
    default_detail = (
        "This layout was changed since you opened it. Reload to get the latest "
        "version, then re-apply your changes."
    )
    default_code = "stale_workbook_layout"

from indicators.models import Indicator
from organizations.access import is_organization_admin, request_mode_value
from users.permissions import HasModulePermission

from .models import (
    WorkbookLayout,
    WorkbookLayoutItem,
)


def can_edit_workbook_layout(user, coordinator_org_id) -> bool:
    """Who may create/edit a layout for ``coordinator_org_id``.

    Admins and M&E Managers may edit any coordinator's layout. A non-manager may
    edit ONLY when their own organization IS the coordinator (a "coordinator
    user"). Clients and unauthenticated users never edit.
    """
    if not user or not getattr(user, "pk", None):
        return False
    if is_organization_admin(user) or getattr(user, "role", None) == "manager":
        return True
    if getattr(user, "role", None) == "client":
        return False
    user_org_id = getattr(user, "organization_id", None)
    try:
        return bool(user_org_id and int(user_org_id) == int(coordinator_org_id))
    except (TypeError, ValueError):
        return False


class WorkbookLayoutItemSerializer(serializers.ModelSerializer):
    indicator_name = serializers.CharField(source="indicator.name", read_only=True)
    indicator_code = serializers.CharField(source="indicator.code", read_only=True)

    class Meta:
        model = WorkbookLayoutItem
        fields = [
            "id", "indicator", "indicator_name", "indicator_code",
            "section_title", "order_index", "is_required",
        ]


class WorkbookLayoutSerializer(serializers.ModelSerializer):
    items = WorkbookLayoutItemSerializer(many=True, required=False)
    coordinator_name = serializers.CharField(
        source="coordinator_organization.name", read_only=True,
    )
    # Optimistic concurrency: the client echoes the ``updated_at`` it last saw;
    # if the row has moved on since, the save is rejected (409) instead of
    # silently clobbering another editor's changes.
    expected_updated_at = serializers.DateTimeField(write_only=True, required=False)

    class Meta:
        model = WorkbookLayout
        fields = [
            "id", "coordinator_organization", "coordinator_name", "name", "mode",
            "is_active", "items", "expected_updated_at",
            "created_by", "updated_by", "created_at", "updated_at",
        ]
        read_only_fields = ["mode", "created_by", "updated_by", "created_at", "updated_at"]

    def validate_items(self, value):
        seen = set()
        for item in value:
            indicator = item.get("indicator")
            if indicator is None:
                if not (item.get("section_title") or "").strip():
                    raise serializers.ValidationError(
                        "Each item must be an indicator or a section heading."
                    )
                continue
            ind_id = getattr(indicator, "id", indicator)
            if ind_id in seen:
                raise serializers.ValidationError(
                    "The same indicator may not appear twice in one layout."
                )
            seen.add(ind_id)
        return value

    def _write_items(self, layout, items):
        layout.items.all().delete()
        rows = [
            WorkbookLayoutItem(
                layout=layout,
                indicator=item.get("indicator"),
                section_title=(item.get("section_title") or "").strip(),
                order_index=item.get("order_index", idx),
                is_required=item.get("is_required", False),
            )
            for idx, item in enumerate(items)
        ]
        WorkbookLayoutItem.objects.bulk_create(rows)

    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop("expected_updated_at", None)
        items = validated_data.pop("items", [])
        layout = WorkbookLayout.objects.create(**validated_data)
        self._write_items(layout, items)
        return layout

    @transaction.atomic
    def update(self, instance, validated_data):
        expected = validated_data.pop("expected_updated_at", None)
        if expected is not None and instance.updated_at is not None:
            # The client echoes the exact updated_at it last saw; any concurrent
            # save moves it forward. Allow ≤1ms for serialization rounding only.
            if abs((instance.updated_at - expected).total_seconds()) > 0.001:
                raise WorkbookLayoutConflict()
        items = validated_data.pop("items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if items is not None:
            self._write_items(instance, items)
        return instance


def _auto_assign_layout_indicators(layout):
    """Make "placing = assigning": ensure every active, canonical indicator placed
    in ``layout`` is assigned to the coordinator's org tree in its CURRENT project.

    "Current project" = the coordinator's most recent active project matching the
    layout's environment (live/training), preferring one that is ongoing today.
    Aliases and inactive indicators are skipped (they can never surface in a
    generated workbook, so assigning them would only create dead rows).

    Best-effort: a failure here must never block the layout save, so all DB errors
    are swallowed. Idempotent — re-saving never duplicates assignments.
    """
    from datetime import date

    from django.db import DatabaseError

    from organizations.models import Organization

    from .models import Project, ProjectIndicator, ProjectOrganization
    from .project_indicator_links import ensure_project_indicator_link
    from .project_indicator_scope_sync import ensure_project_indicator_assignments

    try:
        coord = Organization.objects.filter(id=layout.coordinator_organization_id).first()
        if coord is None:
            return

        is_training = layout.mode == "training"
        proj_ids = list(
            ProjectOrganization.objects.filter(
                organization_id=coord.id, is_active=True,
            ).values_list("project_id", flat=True)
        )
        projects = list(Project.objects.filter(id__in=proj_ids, is_training=is_training))
        if not projects:
            return

        today = date.today()
        ongoing = [
            p for p in projects
            if (p.start_date or today) <= today <= (p.end_date or today)
        ]
        pool = ongoing or projects
        project = max(pool, key=lambda p: (p.start_date or date.min))

        tree_ids = {coord.id} | {o.id for o in coord.get_descendants()}
        proj_org_ids = set(
            ProjectOrganization.objects.filter(
                project=project, is_active=True,
            ).values_list("organization_id", flat=True)
        )
        org_ids = tree_ids & proj_org_ids
        if not org_ids:
            return

        placed = list(dict.fromkeys(
            item.indicator_id for item in layout.items.all() if item.indicator_id
        ))
        if not placed:
            return
        # Only active, canonical indicators can appear in a workbook.
        assignable = set(
            Indicator.objects.filter(
                id__in=placed, is_active=True, canonical_indicator__isnull=True,
            ).values_list("id", flat=True)
        )
        for ind_id in placed:
            if ind_id not in assignable:
                continue
            ensure_project_indicator_link(project, ind_id)
            pi = ProjectIndicator.objects.filter(
                project=project, indicator_id=ind_id,
            ).first()
            if pi is not None:
                ensure_project_indicator_assignments(
                    pi, organization_ids=org_ids, source="workbook_layout",
                )
    except DatabaseError:
        return


class WorkbookLayoutViewSet(viewsets.ModelViewSet):
    """CRUD for coordinator Workbook Layouts (indicator ordering templates)."""

    serializer_class = WorkbookLayoutSerializer
    required_module = "projects"
    permission_classes = [IsAuthenticated, HasModulePermission]

    def get_queryset(self):
        qs = (
            WorkbookLayout.objects.select_related("coordinator_organization")
            .prefetch_related("items", "items__indicator")
            .filter(mode=request_mode_value(self.request))
        )
        coordinator = self.request.query_params.get("coordinator")
        if coordinator:
            qs = qs.filter(coordinator_organization_id=coordinator)
        return qs

    def _assert_can_edit(self, coordinator_org_id):
        if not can_edit_workbook_layout(self.request.user, coordinator_org_id):
            raise PermissionDenied(
                "You may only edit the workbook layout for your own coordinator."
            )

    def _duplicate_indicators_response(self, request):
        """If the payload places the same indicator more than once, return a
        structured 400 the editor can act on — naming each duplicated indicator
        and the 1-based positions (indicator order, headings excluded) where it
        appears — instead of an opaque text error. Returns None when clean.

        ``WorkbookLayoutSerializer.validate_items`` remains the last-resort
        text safety net for any caller that bypasses the view.
        """
        items = request.data.get("items")
        if not isinstance(items, list):
            return None
        positions: dict[int, list[int]] = {}
        num = 0
        for item in items:
            if not isinstance(item, dict):
                continue
            indicator = item.get("indicator")
            if indicator in (None, ""):
                continue  # section heading / blank row
            num += 1
            try:
                ind_id = int(indicator)
            except (TypeError, ValueError):
                continue
            positions.setdefault(ind_id, []).append(num)
        dups = {ind_id: pos for ind_id, pos in positions.items() if len(pos) > 1}
        if not dups:
            return None
        names = dict(
            Indicator.objects.filter(id__in=dups.keys()).values_list("id", "name")
        )
        return Response(
            {
                "error": "duplicate_indicators",
                "duplicates": [
                    {
                        "indicator_id": ind_id,
                        "indicator_name": names.get(ind_id, f"Indicator {ind_id}"),
                        "positions": pos,
                    }
                    for ind_id, pos in dups.items()
                ],
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def create(self, request, *args, **kwargs):
        dup = self._duplicate_indicators_response(request)
        if dup is not None:
            return dup
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        # Covers PUT and PATCH (DRF routes partial_update through update()).
        dup = self._duplicate_indicators_response(request)
        if dup is not None:
            return dup
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        coordinator_org = serializer.validated_data.get("coordinator_organization")
        self._assert_can_edit(getattr(coordinator_org, "id", None))
        try:
            serializer.save(
                mode=request_mode_value(self.request),
                created_by=self.request.user,
                updated_by=self.request.user,
            )
        except IntegrityError:
            raise serializers.ValidationError(
                {"detail": "This coordinator already has an active workbook layout. "
                           "Edit the existing layout instead."}
            )
        _auto_assign_layout_indicators(serializer.instance)

    def perform_update(self, serializer):
        instance = serializer.instance
        self._assert_can_edit(instance.coordinator_organization_id)
        if instance.mode != request_mode_value(self.request):
            raise PermissionDenied(
                "This layout belongs to a different environment (live/training)."
            )
        serializer.save(updated_by=self.request.user)
        _auto_assign_layout_indicators(serializer.instance)

    def perform_destroy(self, instance):
        self._assert_can_edit(instance.coordinator_organization_id)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="available-indicators")
    def available_indicators(self, request):
        """Indicator palette for the layout editor.

        Returns EVERY active, canonical indicator in the system so an admin can
        compose each coordinator's workbook from the full catalogue. It is
        intentionally NOT scoped to the coordinator's assignments: placing an
        indicator in a layout is a display/ordering choice and does not make any
        organisation responsible for reporting it. Project/period independent —
        matches the layout's project-independent nature. Canonical only (alias
        variants are folded onto their canonical indicator).

        The `coordinator` query param is still required and validated so the
        editor always loads against a real coordinator (and to keep the
        front-end contract unchanged).
        """
        coordinator_id = request.query_params.get("coordinator")
        if not coordinator_id:
            return Response({"detail": "coordinator query param is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Guard against non-integer ids (e.g. a front-end "NaN"): a raw filter on
        # the id field would raise ValueError → 500. Fail with a clean 400.
        try:
            coordinator_id = int(coordinator_id)
        except (TypeError, ValueError):
            return Response({"detail": "coordinator must be a valid organization id."},
                            status=status.HTTP_400_BAD_REQUEST)
        from organizations.models import Organization
        coordinator = Organization.objects.filter(id=coordinator_id).first()
        if not coordinator:
            return Response({"detail": "Coordinator not found."},
                            status=status.HTTP_404_NOT_FOUND)

        indicators = (
            Indicator.objects.filter(is_active=True)
            .exclude(canonical_indicator__isnull=False)
            .order_by("category", "name")
        )
        data = [
            {
                "id": ind.id,
                "code": ind.code,
                "name": ind.name,
                "category": ind.category,
                "category_display": ind.get_category_display(),
            }
            for ind in indicators
        ]
        return Response(data)
