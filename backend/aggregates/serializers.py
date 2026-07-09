from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError
from .models import Aggregate, ReportingPeriod
from .validation import validate_aggregate_value


class AggregateSerializer(serializers.ModelSerializer):
    """Serializer for Aggregate model."""

    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)
    project_name = serializers.CharField(source='project.name', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    reviewed_by_name = serializers.CharField(source='reviewed_by.username', read_only=True)
    
    class Meta:
        model = Aggregate
        fields = [
            'id', 'indicator', 'indicator_name', 'indicator_code',
            'project', 'project_name', 'organization', 'organization_name',
            'period_start', 'period_end', 'value',
            'status', 'reviewed_at', 'reviewed_by', 'reviewed_by_name',
            'notes', 'copy_paste_verified', 'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = [
            'id',
            'status',
            'reviewed_at',
            'reviewed_by',
            'created_at',
            'updated_at',
            'created_by',
        ]
        # Drop DRF's auto-generated UniqueTogetherValidator for
        # (indicator, project, organization, period_start, period_end).
        #
        # Every write path (single create, bulk_create, workbook import) routes
        # through ``_upsert_pending_aggregate`` which does an ``update_or_create``
        # on exactly this natural key, and the model carries a DB-level unique
        # constraint as the hard backstop. The serializer-level validator is not
        # only redundant — it is actively harmful: it makes ``is_valid()`` reject
        # any row whose natural key already exists, so a re-submission/re-upload
        # (the idempotent "update existing" case) fails with a confusing 400 and
        # the upsert never runs. Removing it lets re-uploads update in place
        # while the DB constraint still guarantees no duplicate rows. See
        # IMP-1 / WorkbookDuplicatePreventionTests.
        validators = []

    def validate(self, attrs):
        """Server-side data-quality guards (readiness blocker C4 / risk R1).

        Enforces reporting-period ordering and the aggregate ``value`` shape so
        malformed or out-of-range numbers can never reach the reporting tables.
        Works for both single and bulk create/update (partial updates only
        re-validate the fields actually supplied).
        """
        attrs = super().validate(attrs)

        instance = getattr(self, 'instance', None)
        period_start = attrs.get(
            'period_start', getattr(instance, 'period_start', None)
        )
        period_end = attrs.get('period_end', getattr(instance, 'period_end', None))
        if period_start and period_end and period_start > period_end:
            raise serializers.ValidationError({
                'period_end': 'Reporting period end cannot be before the start date.'
            })

        if 'value' in attrs:
            indicator = attrs.get('indicator', getattr(instance, 'indicator', None))
            attrs['value'] = validate_aggregate_value(
                attrs['value'], indicator=indicator
            )
        return attrs


class AggregateLightSerializer(serializers.ModelSerializer):
    """Lightweight read-only projection for bulk dashboard/analytics fetches.

    Drops notes + review/audit fields (notes, reviewed_*, copy_paste_verified,
    created_*) that those screens never read, cutting the per-record payload of
    the all-pages aggregate fetch. Opt-in via ?light=1 on the list endpoint.
    Keep this in sync with the fields the dashboard actually consumes
    (lib/dashboard/screening-insights.ts + the home dashboard page).
    """

    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)
    project_name = serializers.CharField(source='project.name', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)

    class Meta:
        model = Aggregate
        fields = [
            'id', 'indicator', 'indicator_name', 'indicator_code',
            'project', 'project_name', 'organization', 'organization_name',
            'period_start', 'period_end', 'value', 'status', 'updated_at',
        ]
        read_only_fields = fields


class ReportingPeriodSerializer(serializers.ModelSerializer):
    """Admin-facing serializer for :class:`ReportingPeriod`.

    Coverage dates are always derived from (quarter, fiscal_year) server-side, so
    they are read-only; the client only supplies the project/quarter/fiscal-year
    and the administrator-controlled window. ``status`` transitions go through the
    dedicated lifecycle actions (open/close/schedule/…), never a raw PATCH, so it
    is read-only here too.
    """

    project_name = serializers.CharField(source='project.name', read_only=True)
    project_code = serializers.CharField(source='project.code', read_only=True)
    quarter_label = serializers.CharField(read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    earliest_open_date = serializers.DateField(read_only=True)

    class Meta:
        model = ReportingPeriod
        fields = [
            'id', 'project', 'project_name', 'project_code',
            'fiscal_year', 'quarter', 'quarter_label',
            'coverage_start', 'coverage_end', 'earliest_open_date',
            'submission_opens', 'submission_closes', 'status',
            'allow_late_reporting', 'late_reporting_opens', 'late_reporting_closes',
            'notes', 'created_by', 'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'coverage_start', 'coverage_end', 'earliest_open_date',
            'status', 'created_by', 'created_at', 'updated_at',
        ]

    def validate(self, attrs):
        # Run the model's invariants (quarter-completion floor on the window,
        # window ordering, late-window ordering) through DRF so mis-configured
        # windows are rejected with field errors instead of a 500.
        instance = ReportingPeriod(**{**self._instance_kwargs(), **attrs})
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, 'message_dict') else exc.messages)
        return attrs

    def _instance_kwargs(self):
        if self.instance is None:
            return {}
        return {
            'project': self.instance.project,
            'fiscal_year': self.instance.fiscal_year,
            'quarter': self.instance.quarter,
            'status': self.instance.status,
            'submission_opens': self.instance.submission_opens,
            'submission_closes': self.instance.submission_closes,
            'allow_late_reporting': self.instance.allow_late_reporting,
            'late_reporting_opens': self.instance.late_reporting_opens,
            'late_reporting_closes': self.instance.late_reporting_closes,
        }
