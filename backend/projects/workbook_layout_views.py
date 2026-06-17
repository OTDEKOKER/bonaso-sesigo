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
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from indicators.models import Indicator
from organizations.access import is_organization_admin, request_mode_value
from users.permissions import HasModulePermission

from .models import (
    ProjectIndicatorAssignment,
    ProjectIndicatorOrganizationTarget,
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

    class Meta:
        model = WorkbookLayout
        fields = [
            "id", "coordinator_organization", "coordinator_name", "name", "mode",
            "is_active", "items", "created_by", "updated_by", "created_at", "updated_at",
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
        items = validated_data.pop("items", [])
        layout = WorkbookLayout.objects.create(**validated_data)
        self._write_items(layout, items)
        return layout

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if items is not None:
            self._write_items(instance, items)
        return instance


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

    def perform_update(self, serializer):
        instance = serializer.instance
        self._assert_can_edit(instance.coordinator_organization_id)
        if instance.mode != request_mode_value(self.request):
            raise PermissionDenied(
                "This layout belongs to a different environment (live/training)."
            )
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        self._assert_can_edit(instance.coordinator_organization_id)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="available-indicators")
    def available_indicators(self, request):
        """Indicators available within a coordinator's scope, for the layout editor.

        The union of indicators assigned (or targeted) to the coordinator and its
        sub-organisations, across all projects. Project/period independent —
        matches the layout's project-independent nature. Canonical only (alias
        variants are folded onto their canonical indicator).
        """
        coordinator_id = request.query_params.get("coordinator")
        if not coordinator_id:
            return Response({"detail": "coordinator query param is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        from organizations.models import Organization
        coordinator = Organization.objects.filter(id=coordinator_id).first()
        if not coordinator:
            return Response({"detail": "Coordinator not found."},
                            status=status.HTTP_404_NOT_FOUND)

        org_ids = [coordinator.id] + [o.id for o in coordinator.get_descendants()]
        ind_ids = set(
            ProjectIndicatorAssignment.objects.filter(
                organization_id__in=org_ids, is_active=True,
            ).values_list("project_indicator__indicator_id", flat=True)
        )
        ind_ids |= set(
            ProjectIndicatorOrganizationTarget.objects.filter(
                organization_id__in=org_ids,
            ).values_list("project_indicator__indicator_id", flat=True)
        )
        indicators = (
            Indicator.objects.filter(id__in=ind_ids, is_active=True)
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
