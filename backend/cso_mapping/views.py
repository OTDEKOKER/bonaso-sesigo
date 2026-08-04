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

import re
from io import BytesIO

from django.db.models import Count, Q
from django.http import HttpResponse
from openpyxl import Workbook
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import CsoMappingSubmission
from .permissions import IsAdminRole
from .schema import (
    CORE_BOOL_FIELDS,
    CORE_TEXT_FIELDS,
    field_is_active,
    iter_answerable_fields,
    load_schema,
)
from .serializers import PublicSubmissionSerializer, StaffSubmissionSerializer

# Characters Excel forbids in a worksheet title, plus the 31-char cap.
_INVALID_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")


def _safe_sheet_title(label: str) -> str:
    return _INVALID_SHEET_CHARS.sub(" ", label).strip()[:31] or "Sheet"


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

    # Short, Excel-safe worksheet titles per respondent category.
    SHEET_TITLES = {
        "cso": "Health Service CSOs",
        "coordinating_body": "Coordinating Bodies",
        "strategic_structure": "Strategic Structures",
    }

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Excel workbook with one sheet per respondent category.

        Each sheet carries only the questions relevant to that category (admin
        fields + that annex + final confirmation), one row per submission. The
        respondent-type filter is ignored (the workbook is split by category by
        design); a ``search`` term, if given, is applied across all sheets.
        """
        schema = load_schema()
        base = self.get_queryset()
        search = request.query_params.get("search")
        if search:
            base = base.filter(
                Q(responding_entity__icontains=search)
                | Q(respondent_name__icontains=search)
                | Q(primary_district__icontains=search)
            )

        wb = Workbook()
        wb.remove(wb.active)  # drop the auto-created default sheet

        for choice in schema.get("choices", {}).get("respondent_type", []):
            rtype = choice["name"]
            context = {"consent": "yes", "respondent_type": rtype}
            columns = [
                (field["name"], field.get("label") or field["name"])
                for section, field in iter_answerable_fields(schema)
                if field_is_active(section, field, context)
            ]
            ws = wb.create_sheet(
                title=self.SHEET_TITLES.get(rtype) or _safe_sheet_title(choice["label"])
            )
            ws.append(["ID", "Submitted at"] + [label for _name, label in columns])
            for sub in base.filter(respondent_type=rtype):
                # openpyxl cannot write tz-aware datetimes; store as naive.
                row = [sub.id, sub.submitted_at.replace(tzinfo=None)]
                answers = sub.answers or {}
                for name, _label in columns:
                    if name in CORE_BOOL_FIELDS:
                        row.append("Yes" if getattr(sub, name) else "No")
                    elif name in CORE_TEXT_FIELDS:
                        row.append(getattr(sub, name) or "")
                    else:
                        row.append(answers.get(name, ""))
                ws.append(row)

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = 'attachment; filename="cso-mapping-submissions.xlsx"'
        return response
