"""Grant viewsets.

Every viewset applies the same scope gates used across the codebase, so no
financial row is ever visible outside the viewer's project + org scope:
  1. ``GrantsPermission``                       — deny-by-default module access.
  2. ``apply_training_filter``                  — training grants never hit live.
  3. ``filter_queryset_by_assigned_projects``   — project-assignment gate.
  4. org scope (own org + descendants)          — coordinators see their subtree.

Writes additionally require the finance tier (``can_manage_grants``) and are
constrained to the writer's own scope + the training/live boundary, and audited.
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from audit.recording import record_audit_event
from organizations.access import (
    apply_training_filter,
    assert_project_write_allowed,
    get_user_organization_ids,
    is_organization_admin,
)
from projects.scope import filter_queryset_by_assigned_projects

from .models import Grant, GrantBudgetLine, GrantDisbursement, GrantExpenditure
from .permissions import GrantsPermission
from .rollups import summarize_by_organization
from .serializers import (
    GrantBudgetLineSerializer,
    GrantDetailSerializer,
    GrantDisbursementSerializer,
    GrantExpenditureSerializer,
    GrantSerializer,
)


def scope_grants_queryset(qs, request, *, project_lookup, org_lookup):
    """Apply the training + project-assignment + org-scope gates (non-admins)."""
    qs = apply_training_filter(qs, request, project_lookup=project_lookup)
    user = request.user
    if is_organization_admin(user):
        return qs
    qs = filter_queryset_by_assigned_projects(qs, user, f"{project_lookup}_id")
    org_ids = get_user_organization_ids(user)
    if org_ids:
        return qs.filter(**{f"{org_lookup}_id__in": org_ids})
    return qs.none()


class GrantViewSet(viewsets.ModelViewSet):
    """Grants (funding awards) — read for the grants module, write for finance."""

    queryset = Grant.objects.all()
    permission_classes = [GrantsPermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["project", "organization", "coordinator", "funder", "status"]
    search_fields = ["code", "title", "notes"]
    ordering_fields = ["created_at", "total_amount", "start_date", "end_date", "status"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        return GrantDetailSerializer if self.action == "retrieve" else GrantSerializer

    def get_queryset(self):
        qs = Grant.objects.select_related(
            "project", "organization", "coordinator", "funder", "created_by"
        )
        return scope_grants_queryset(
            qs, self.request, project_lookup="project", org_lookup="organization"
        )

    def _assert_write_scope(self, project, organization):
        """Non-admin finance writers may only touch grants in their own scope."""
        assert_project_write_allowed(self.request, project)
        user = self.request.user
        if is_organization_admin(user):
            return
        allowed = set(get_user_organization_ids(user) or [])
        if not organization or organization.id not in allowed:
            raise PermissionDenied("You may not manage grants for this organization.")

    def perform_create(self, serializer):
        self._assert_write_scope(
            serializer.validated_data.get("project"),
            serializer.validated_data.get("organization"),
        )
        grant = serializer.save(created_by=self.request.user)
        record_audit_event(
            action="grant.create", request=self.request, object_type="grant",
            object_id=grant.id, organization=grant.organization, project=grant.project,
            description=f"Created grant {grant.code or grant.id} ({grant.total_amount} {grant.currency}).",
        )

    def perform_update(self, serializer):
        self._assert_write_scope(
            serializer.validated_data.get("project", serializer.instance.project),
            serializer.validated_data.get("organization", serializer.instance.organization),
        )
        grant = serializer.save()
        record_audit_event(
            action="grant.update", request=self.request, object_type="grant",
            object_id=grant.id, organization=grant.organization, project=grant.project,
            description=f"Updated grant {grant.code or grant.id}.",
        )

    def perform_destroy(self, instance):
        record_audit_event(
            action="grant.delete", request=self.request, object_type="grant",
            object_id=instance.id, organization=instance.organization, project=instance.project,
            description=f"Deleted grant {instance.code or instance.id}.",
        )
        instance.delete()

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Per-organization awarded/disbursed/spent/remaining/burn + grand total,
        scoped to what the viewer may see."""
        return Response(summarize_by_organization(self.get_queryset()))


class _GrantChildViewSet(viewsets.ModelViewSet):
    """Shared scoping for budget lines / disbursements / expenditures."""

    permission_classes = [GrantsPermission]
    filter_backends = [DjangoFilterBackend, OrderingFilter]

    def _base_qs(self):
        raise NotImplementedError

    def get_queryset(self):
        return scope_grants_queryset(
            self._base_qs(), self.request,
            project_lookup="grant__project", org_lookup="grant__organization",
        )

    def _assert_write(self, grant):
        assert_project_write_allowed(self.request, grant.project)
        user = self.request.user
        if is_organization_admin(user):
            return
        allowed = set(get_user_organization_ids(user) or [])
        if grant.organization_id not in allowed:
            raise PermissionDenied("You may not manage financial records for this grant.")

    def perform_create(self, serializer):
        grant = serializer.validated_data.get("grant")
        self._assert_write(grant)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        grant = serializer.validated_data.get("grant", serializer.instance.grant)
        self._assert_write(grant)
        serializer.save()


class GrantBudgetLineViewSet(_GrantChildViewSet):
    queryset = GrantBudgetLine.objects.all()
    serializer_class = GrantBudgetLineSerializer
    filterset_fields = ["grant", "category"]
    ordering_fields = ["category", "budgeted_amount"]

    def _base_qs(self):
        return GrantBudgetLine.objects.select_related("grant", "grant__organization", "grant__project")

    # Budget lines carry no created_by field.
    def perform_create(self, serializer):
        grant = serializer.validated_data.get("grant")
        self._assert_write(grant)
        serializer.save()


class GrantDisbursementViewSet(_GrantChildViewSet):
    queryset = GrantDisbursement.objects.all()
    serializer_class = GrantDisbursementSerializer
    filterset_fields = ["grant", "date"]
    ordering_fields = ["date", "amount", "tranche"]

    def _base_qs(self):
        return GrantDisbursement.objects.select_related("grant", "grant__organization", "grant__project")


class GrantExpenditureViewSet(_GrantChildViewSet):
    queryset = GrantExpenditure.objects.all()
    serializer_class = GrantExpenditureSerializer
    parser_classes = [MultiPartParser, FormParser]
    filterset_fields = ["grant", "date", "category", "budget_line"]
    ordering_fields = ["date", "amount"]

    def _base_qs(self):
        return GrantExpenditure.objects.select_related(
            "grant", "grant__organization", "grant__project", "budget_line"
        )
