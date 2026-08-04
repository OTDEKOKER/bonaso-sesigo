"""API for the CSO Mapping & Capacity Assessment.

Public (unauthenticated) surface:
  * GET  /api/cso-mapping/schema/  — the form definition the frontend renders.
  * POST /api/cso-mapping/submit/  — accept one questionnaire response (throttled).

Authorised-staff surface (admin role only — submissions hold personal data):
  * GET  /api/cso-mapping/submissions/           — list (filter/search/order).
  * GET  /api/cso-mapping/submissions/<id>/      — retrieve one.
  * GET  /api/cso-mapping/submissions/export/    — CSV of all submissions.
  * GET  /api/cso-mapping/submissions/summary/   — counts by respondent type.
"""
from __future__ import annotations

import csv

from django.db.models import Count
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import CsoMappingSubmission
from .permissions import IsAdminRole
from .schema import CORE_BOOL_FIELDS, CORE_TEXT_FIELDS, iter_answerable_fields, load_schema
from .serializers import PublicSubmissionSerializer, StaffSubmissionSerializer


class FormSchemaView(APIView):
    """Public: the canonical form schema the frontend renders.

    A static form definition (no user input), so it is not throttled — many
    respondents behind one office NAT must be able to load the form freely.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        return Response(load_schema())


class SubmissionCreateView(APIView):
    """Public: accept one questionnaire submission.

    The only unauthenticated write path for this app, so it is rate-limited per
    IP (throttle scope ``cso_mapping``). Validation is schema-driven; consent is
    mandatory.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "cso_mapping"

    def post(self, request):
        serializer = PublicSubmissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submission = serializer.save()
        return Response(
            {"id": submission.id, "detail": "Submission received. Thank you."},
            status=status.HTTP_201_CREATED,
        )


class SubmissionViewSet(viewsets.ReadOnlyModelViewSet):
    """Authorised-staff read access to submissions (admin role only)."""

    queryset = CsoMappingSubmission.objects.all()
    serializer_class = StaffSubmissionSerializer
    permission_classes = [IsAdminRole]
    filterset_fields = ["respondent_type"]
    search_fields = ["responding_entity", "respondent_name", "primary_district"]
    ordering_fields = ["submitted_at", "respondent_type", "responding_entity"]
    ordering = ["-submitted_at"]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self.get_queryset()
        by_type = {
            row["respondent_type"]: row["n"]
            for row in qs.values("respondent_type").annotate(n=Count("id"))
        }
        return Response({"total": qs.count(), "by_respondent_type": by_type})

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Flat CSV: one row per submission, one column per answerable field."""
        schema = load_schema()
        columns = [
            (field["name"], f"{field.get('label') or field['name']} [{field['name']}]")
            for _section, field in iter_answerable_fields(schema)
        ]

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            'attachment; filename="cso-mapping-submissions.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(["ID", "Submitted at"] + [header for _name, header in columns])

        for sub in self.filter_queryset(self.get_queryset()):
            row = [sub.id, sub.submitted_at.isoformat()]
            answers = sub.answers or {}
            for name, _header in columns:
                if name in CORE_BOOL_FIELDS:
                    row.append("Yes" if getattr(sub, name) else "No")
                elif name in CORE_TEXT_FIELDS:
                    row.append(getattr(sub, name) or "")
                else:
                    row.append(answers.get(name, ""))
            writer.writerow(row)

        return response
