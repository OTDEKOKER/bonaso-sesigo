"""Administrator API for the Quarterly Reporting Control Framework.

Exposes CRUD + lifecycle transitions for :class:`ReportingPeriod`, plus a
progress/completion view. Every state transition is fully audited (who, when,
project, quarter, reason, IP). All write access is restricted to administrators;
the backend — not the frontend — is the source of truth for who may open, close
or override reporting.
"""
from __future__ import annotations

from django.db.models import Q
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit.recording import record_audit_event
from organizations.access import is_organization_admin
from projects.models import ProjectIndicatorAssignment, ProjectOrganization

from .models import Aggregate, ReportingPeriod
from .serializers import ReportingPeriodSerializer


class IsReportingAdmin(IsAuthenticated):
    """Only administrators may manage reporting periods. Reads are also admin-only
    on this endpoint — organisations see their own window via the lightweight
    ``aggregates/reporting-status`` endpoint, which is scoped to their data."""

    def has_permission(self, request, view):
        return bool(super().has_permission(request, view) and is_organization_admin(request.user))


class ReportingPeriodViewSet(viewsets.ModelViewSet):
    queryset = ReportingPeriod.objects.select_related('project', 'created_by').all()
    serializer_class = ReportingPeriodSerializer
    permission_classes = [IsReportingAdmin]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get('project'):
            qs = qs.filter(project_id=params['project'])
        if params.get('fiscal_year'):
            qs = qs.filter(fiscal_year=params['fiscal_year'])
        if params.get('quarter'):
            qs = qs.filter(quarter=params['quarter'])
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        return qs

    # ── Create / update auditing ─────────────────────────────────────────────
    def perform_create(self, serializer):
        period = serializer.save(created_by=self.request.user)
        self._audit(period, 'reporting_period_created',
                    f'Created reporting period {period.quarter_label}.')

    def perform_update(self, serializer):
        period = serializer.save()
        self._audit(period, 'reporting_period_updated',
                    f'Updated reporting period {period.quarter_label}.')

    def perform_destroy(self, instance):
        # Never destroy a period that already governs live data — closing/
        # archiving is the reversible path. Draft periods (never opened) are safe.
        if instance.status != ReportingPeriod.STATUS_DRAFT:
            raise ValidationError(
                'Only Draft reporting periods may be deleted. Archive instead to '
                'preserve the audit trail.'
            )
        self._audit(instance, 'reporting_period_updated',
                    f'Deleted draft reporting period {instance.quarter_label}.')
        instance.delete()

    # ── Lifecycle transitions ────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def schedule(self, request, pk=None):
        return self._transition(
            request, ReportingPeriod.STATUS_SCHEDULED, 'reporting_scheduled',
            'Scheduled reporting', allowed_from={
                ReportingPeriod.STATUS_DRAFT, ReportingPeriod.STATUS_SCHEDULED,
            })

    @action(detail=True, methods=['post'])
    def open(self, request, pk=None):
        period = self.get_object()
        # Hard quarter-completion rule: never open before the quarter elapses,
        # unless a superuser supplies an audited emergency override.
        if timezone.localdate() < period.earliest_open_date:
            if not (request.user.is_superuser and _override_requested(request)):
                raise ValidationError(
                    f'{period.quarter_label} cannot be opened before the quarter has '
                    f'fully elapsed. Earliest open date is '
                    f'{period.earliest_open_date.isoformat()}.'
                )
            self._audit(
                period, 'reporting_window_override',
                f'Emergency early open of {period.quarter_label} before the quarter '
                f'elapsed.', reason=_reason(request),
            )
        return self._transition(
            request, ReportingPeriod.STATUS_OPEN, 'reporting_opened',
            'Opened reporting', allowed_from={
                ReportingPeriod.STATUS_DRAFT, ReportingPeriod.STATUS_SCHEDULED,
                ReportingPeriod.STATUS_CLOSED, ReportingPeriod.STATUS_OPEN,
            }, period=period)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        return self._transition(
            request, ReportingPeriod.STATUS_CLOSED, 'reporting_closed',
            'Closed reporting', allowed_from={
                ReportingPeriod.STATUS_OPEN, ReportingPeriod.STATUS_SCHEDULED,
                ReportingPeriod.STATUS_CLOSED,
            })

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        return self._transition(
            request, ReportingPeriod.STATUS_OPEN, 'reporting_reopened',
            'Reopened reporting', allowed_from={
                ReportingPeriod.STATUS_CLOSED, ReportingPeriod.STATUS_ARCHIVED,
            })

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        return self._transition(
            request, ReportingPeriod.STATUS_ARCHIVED, 'reporting_archived',
            'Archived reporting', allowed_from={
                ReportingPeriod.STATUS_OPEN, ReportingPeriod.STATUS_CLOSED,
                ReportingPeriod.STATUS_SCHEDULED, ReportingPeriod.STATUS_DRAFT,
            })

    @action(detail=True, methods=['post'], url_path='enable-late')
    def enable_late(self, request, pk=None):
        period = self.get_object()
        opens = request.data.get('late_reporting_opens')
        closes = request.data.get('late_reporting_closes')
        period.allow_late_reporting = True
        if opens is not None:
            period.late_reporting_opens = opens or None
        if closes is not None:
            period.late_reporting_closes = closes or None
        self._full_clean_or_400(period)
        period.save()
        self._audit(period, 'late_reporting_enabled',
                    f'Enabled late reporting for {period.quarter_label}.',
                    reason=_reason(request))
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['post'], url_path='disable-late')
    def disable_late(self, request, pk=None):
        period = self.get_object()
        period.allow_late_reporting = False
        period.save(update_fields=['allow_late_reporting', 'updated_at'])
        self._audit(period, 'late_reporting_disabled',
                    f'Disabled late reporting for {period.quarter_label}.',
                    reason=_reason(request))
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Create the NEXT quarter's period by copying this one's window offsets.
        Useful so admins do not re-enter the same window rules each quarter."""
        source = self.get_object()
        next_q = source.quarter + 1
        next_fy = source.fiscal_year
        if next_q > 4:
            next_q, next_fy = 1, source.fiscal_year + 1
        if ReportingPeriod.objects.filter(
            project=source.project, fiscal_year=next_fy, quarter=next_q,
        ).exists():
            raise ValidationError('A reporting period already exists for the next quarter.')
        clone = ReportingPeriod(
            project=source.project, fiscal_year=next_fy, quarter=next_q,
            status=ReportingPeriod.STATUS_DRAFT,
            allow_late_reporting=source.allow_late_reporting,
            notes=source.notes, created_by=request.user,
        )
        clone.save()
        self._audit(clone, 'reporting_period_created',
                    f'Duplicated settings from {source.quarter_label} into '
                    f'{clone.quarter_label}.')
        return Response(self.get_serializer(clone).data, status=http_status.HTTP_201_CREATED)

    # ── Progress / completion ────────────────────────────────────────────────
    @action(detail=True, methods=['get'])
    def progress(self, request, pk=None):
        period = self.get_object()
        return Response(build_progress(period))

    # ── helpers ───────────────────────────────────────────────────────────────
    def _transition(self, request, new_status, audit_action, verb,
                    *, allowed_from, period=None):
        period = period or self.get_object()
        if period.status not in allowed_from:
            raise ValidationError(
                f'Cannot {audit_action.replace("reporting_", "").replace("_", " ")} '
                f'a period that is currently {period.get_status_display()}.'
            )
        period.status = new_status
        # Opening/scheduling may carry the window dates in the same request.
        for field in ('submission_opens', 'submission_closes'):
            if field in request.data and request.data.get(field) not in ('', None):
                setattr(period, field, request.data.get(field))
        self._full_clean_or_400(period)
        period.save()
        self._audit(period, audit_action,
                    f'{verb} {period.quarter_label}.', reason=_reason(request))
        return Response(self.get_serializer(period).data)

    def _full_clean_or_400(self, period):
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            period.clean()
        except DjangoValidationError as exc:
            raise ValidationError(exc.message_dict if hasattr(exc, 'message_dict') else exc.messages)

    def _audit(self, period, action_name, description, *, reason=''):
        record_audit_event(
            action=action_name,
            request=self.request,
            object_type='reporting_period',
            object_id=period.id,
            organization=None,
            project=period.project,
            description=description + (f' Reason: {reason}' if reason else ''),
            metadata={
                'reporting_period_id': period.id,
                'quarter': period.quarter,
                'fiscal_year': period.fiscal_year,
                'status': period.status,
                'reason': reason,
            },
        )


def _override_requested(request) -> bool:
    val = request.data.get('allow_early_reporting') or request.query_params.get('allow_early_reporting')
    return str(val).strip().lower() in {'1', 'true', 'yes', 'on', 'y'}


def _reason(request) -> str:
    return str(request.data.get('reason') or '').strip()


def eligible_org_ids(project) -> set[int]:
    """Organisations eligible to report for a project = assigned to the project
    (active membership) AND holding at least one active indicator assignment.
    This reuses the existing assignment architecture as the sole source of truth
    — no separate eligibility table."""
    assigned = set(
        ProjectOrganization.objects
        .filter(project=project, is_active=True)
        .values_list('organization_id', flat=True)
    )
    with_indicators = set(
        ProjectIndicatorAssignment.objects
        .filter(project_indicator__project=project, is_active=True)
        .values_list('organization_id', flat=True)
    )
    return assigned & with_indicators


def build_progress(period) -> dict:
    """Completion snapshot for one reporting period. Single grouped query over
    aggregates for the coverage window + one indexed eligibility query — no N+1."""
    eligible = eligible_org_ids(period.project)
    eligible_count = len(eligible)

    rows = (
        Aggregate.objects
        .filter(
            project=period.project,
            period_start=period.coverage_start,
            period_end=period.coverage_end,
            organization_id__in=eligible or [0],
        )
        .values('organization_id', 'status')
    )
    submitted, approved, rejected = set(), set(), set()
    for r in rows:
        oid = r['organization_id']
        submitted.add(oid)
        if r['status'] == 'approved':
            approved.add(oid)
        elif r['status'] == 'rejected':
            rejected.add(oid)

    outstanding = eligible - submitted
    completion = round(100 * len(submitted) / eligible_count, 1) if eligible_count else 0.0
    return {
        'reporting_period_id': period.id,
        'project': period.project_id,
        'quarter': period.quarter,
        'fiscal_year': period.fiscal_year,
        'status': period.status,
        'eligible_organizations': eligible_count,
        'submitted_organizations': len(submitted),
        'approved_organizations': len(approved),
        'rejected_organizations': len(rejected),
        'outstanding_organizations': len(outstanding),
        'completion_percentage': completion,
        'outstanding_organization_ids': sorted(outstanding),
        'approved_organization_ids': sorted(approved),
        'rejected_organization_ids': sorted(rejected),
    }
