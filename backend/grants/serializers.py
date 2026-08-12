"""Grant serializers."""
from rest_framework import serializers

from .models import Grant, GrantBudgetLine, GrantDisbursement, GrantExpenditure
from .rollups import grant_financials

# Mirror the uploads hardening: only allow safe document extensions and cap size.
ALLOWED_DOC_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv", ".doc", ".docx"}
MAX_DOC_BYTES = 10 * 1024 * 1024  # 10 MB


class GrantBudgetLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantBudgetLine
        fields = ["id", "grant", "category", "description", "budgeted_amount",
                  "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class GrantDisbursementSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantDisbursement
        fields = ["id", "grant", "date", "tranche", "amount", "reference", "notes",
                  "created_by", "created_at", "updated_at"]
        read_only_fields = ["created_by", "created_at", "updated_at"]


class GrantExpenditureSerializer(serializers.ModelSerializer):
    class Meta:
        model = GrantExpenditure
        fields = ["id", "grant", "budget_line", "date", "category", "amount",
                  "description", "supporting_document", "created_by",
                  "created_at", "updated_at"]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def validate_supporting_document(self, f):
        if not f:
            return f
        import os
        ext = os.path.splitext(getattr(f, "name", ""))[1].lower()
        if ext not in ALLOWED_DOC_EXTENSIONS:
            raise serializers.ValidationError(
                f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_DOC_EXTENSIONS))}."
            )
        if getattr(f, "size", 0) and f.size > MAX_DOC_BYTES:
            raise serializers.ValidationError("File too large (max 10 MB).")
        return f


class GrantSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    coordinator_name = serializers.CharField(source="coordinator.name", read_only=True, default=None)
    funder_name = serializers.CharField(source="funder.name", read_only=True, default=None)
    financials = serializers.SerializerMethodField()

    class Meta:
        model = Grant
        fields = [
            "id", "project", "project_name", "organization", "organization_name",
            "coordinator", "coordinator_name", "funder", "funder_name",
            "code", "title", "currency", "total_amount", "start_date", "end_date",
            "status", "notes", "created_by", "created_at", "updated_at", "financials",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def get_financials(self, obj):
        return grant_financials(obj)


class GrantDetailSerializer(GrantSerializer):
    budget_lines = GrantBudgetLineSerializer(many=True, read_only=True)
    disbursements = GrantDisbursementSerializer(many=True, read_only=True)
    expenditures = GrantExpenditureSerializer(many=True, read_only=True)

    class Meta(GrantSerializer.Meta):
        fields = GrantSerializer.Meta.fields + ["budget_lines", "disbursements", "expenditures"]
