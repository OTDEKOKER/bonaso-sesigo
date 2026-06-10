from rest_framework import serializers
from .models import Aggregate
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
