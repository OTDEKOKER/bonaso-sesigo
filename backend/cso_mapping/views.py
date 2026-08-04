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

from django.db import IntegrityError
from django.db.models import Count, Q
from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit.recording import record_audit_event

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

# Leading characters a spreadsheet may interpret as a formula. Respondent text
# beginning with one of these is prefixed with an apostrophe so the cell is a
# literal string (formula / CSV-injection defence). The stored value is unchanged.
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def _safe_sheet_title(label: str) -> str:
    return _INVALID_SHEET_CHARS.sub(" ", label).strip()[:31] or "Sheet"


def _excel_safe(value):
    """Neutralise formula-injection in a spreadsheet cell (leave DB value as-is)."""
    if isinstance(value, str) and value[:1] in _FORMULA_TRIGGERS:
        return "'" + value
    return value


def _submission_receipt(submission, *, created):
    """Public-safe receipt payload — a reference, not the sequential PK."""
    return {
        "reference": submission.public_reference,
        "submitted_at": submission.submitted_at,
        "responding_entity": submission.responding_entity,
        "detail": (
            "Submission received. Thank you."
            if created
            else "This response has already been received. Thank you."
        ),
    }


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
        client_id = serializer.validated_data.get("client_submission_id")

        # Idempotent replay: the same questionnaire attempt (client_submission_id)
        # returns the original receipt instead of creating a second row.
        if client_id:
            existing = CsoMappingSubmission.objects.filter(
                client_submission_id=client_id
            ).first()
            if existing:
                return Response(
                    _submission_receipt(existing, created=False), status=status.HTTP_200_OK
                )
        try:
            submission = serializer.save()
        except IntegrityError:
            # A concurrent duplicate with the same id won the race — return theirs.
            submission = CsoMappingSubmission.objects.filter(
                client_submission_id=client_id
            ).first()
            if submission is None:
                raise
            return Response(
                _submission_receipt(submission, created=False), status=status.HTTP_200_OK
            )
        return Response(
            _submission_receipt(submission, created=True), status=status.HTTP_201_CREATED
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

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        record_audit_event(
            action="view",
            request=request,
            object_type="cso_submission",
            object_id=kwargs.get("pk"),
            description="Viewed a CSO mapping submission",
        )
        return response

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        returned = (
            len(response.data.get("results", []))
            if isinstance(response.data, dict)
            else None
        )
        record_audit_event(
            action="view",
            request=request,
            object_type="cso_submission_list",
            description="Accessed the CSO mapping submissions list",
            metadata={
                "search": request.query_params.get("search", ""),
                "respondent_type": request.query_params.get("respondent_type", ""),
                "returned": returned,
            },
        )
        return response

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
        total_rows = 0

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
            headers = ["Reference", "Submitted at"] + [label for _name, label in columns]
            ws.append(headers)
            for sub in base.filter(respondent_type=rtype):
                # openpyxl cannot write tz-aware datetimes; store as naive.
                submitted = sub.submitted_at.replace(tzinfo=None) if sub.submitted_at else None
                row = [sub.public_reference or "", submitted]
                answers = sub.answers or {}
                for name, _label in columns:
                    if name in CORE_BOOL_FIELDS:
                        row.append("Yes" if getattr(sub, name) else "No")
                    elif name in CORE_TEXT_FIELDS:
                        row.append(_excel_safe(getattr(sub, name) or ""))
                    else:
                        row.append(_excel_safe(answers.get(name, "")))
                ws.append(row)
                total_rows += 1
            self._style_sheet(ws, len(headers))

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        record_audit_event(
            action="export",
            request=request,
            object_type="cso_submission",
            description="Exported CSO mapping submissions to Excel",
            metadata={"search": search or "", "records": total_rows},
        )

        response = HttpResponse(
            buffer.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = 'attachment; filename="cso-mapping-submissions.xlsx"'
        return response

    @staticmethod
    def _style_sheet(ws, num_columns):
        """Freeze the header, enable filters, format dates, cap widths, wrap text."""
        for cell in ws[1]:
            cell.font = Font(bold=True)
        ws.freeze_panes = "A2"
        last_col = get_column_letter(num_columns)
        ws.auto_filter.ref = f"A1:{last_col}{ws.max_row}"
        # Date format on the "Submitted at" column (B), skipping the header.
        for (cell,) in ws.iter_rows(min_row=2, min_col=2, max_col=2):
            cell.number_format = "yyyy-mm-dd hh:mm"
        # Readable-but-capped widths: reference/date narrow, questions wide.
        for idx in range(1, num_columns + 1):
            ws.column_dimensions[get_column_letter(idx)].width = 20 if idx <= 2 else 42
        wrap = Alignment(vertical="top", wrap_text=True)
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = wrap
