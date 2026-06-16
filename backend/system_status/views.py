"""System Status issue drill-down endpoints (admin only).

  GET  issues/<id>/           full diagnostic for one issue
  GET  issues/<id>/download/  CSV of the issue's affected records (parity)
  POST issues/<id>/rerun/     re-run the underlying check
  POST issues/<id>/ack/       mark reviewed / resolved / ignored
"""
import csv
import subprocess

from django.conf import settings
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.recording import record_audit_event
from core.status_views import _is_admin_user
from users.permissions import HasModulePermission

from .checks import find_issue, issue_csv_rows, issue_has_download
from .models import SystemIssueAck

# Map an issue to the check command that regenerates it.
_RERUN_COMMANDS = {
    "parity-latest": ["bash", "scripts/run_monthly_payload_parity_check.sh"],
    "backup-health": ["bash", "scripts/backup_database.sh"],
}


class _AdminView(APIView):
    required_module = "system_status"
    permission_classes = [IsAuthenticated, HasModulePermission]

    def _guard(self, request):
        if not _is_admin_user(request.user):
            return Response({"detail": "You do not have permission to view system status."}, status=403)
        return None


class IssueDetailView(_AdminView):
    def get(self, request, issue_id):
        guard = self._guard(request)
        if guard:
            return guard
        issue = find_issue(issue_id, request)
        if issue is None:
            return Response({"detail": "Issue not found or already cleared."}, status=404)
        return Response(issue)


class IssueDownloadView(_AdminView):
    def get(self, request, issue_id):
        guard = self._guard(request)
        if guard:
            return guard
        issue = find_issue(issue_id, request)
        if issue is None:
            return Response({"detail": "Issue not found or already cleared."}, status=404)
        if not issue_has_download(issue):
            return Response({"detail": "No downloadable report for this issue."}, status=400)

        header, rows = issue_csv_rows(issue)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{issue_id}_mismatches.csv"'
        writer = csv.writer(response)
        writer.writerow(header)
        writer.writerows(rows)
        record_audit_event(
            action="export", request=request, object_type="system_issue", object_id=issue_id,
            description=f"Downloaded mismatch report for issue {issue_id}.",
        )
        return response


class IssueRerunView(_AdminView):
    def post(self, request, issue_id):
        guard = self._guard(request)
        if guard:
            return guard
        cmd = _RERUN_COMMANDS.get(issue_id)
        if not cmd:
            return Response({"detail": "This check cannot be re-run on demand."}, status=400)
        script = settings.BASE_DIR / cmd[1]
        if not script.is_file():
            return Response({"detail": "Check script not found."}, status=500)
        try:
            result = subprocess.run(
                [cmd[0], str(script), *cmd[2:]],
                cwd=str(settings.BASE_DIR), capture_output=True, text=True, timeout=900,
            )
        except subprocess.TimeoutExpired:
            return Response({"detail": "Check timed out."}, status=504)
        record_audit_event(
            action="update", request=request, object_type="system_issue", object_id=issue_id,
            description=f"Re-ran check for issue {issue_id} (rc={result.returncode}).",
        )
        issue = find_issue(issue_id, request)
        return Response({
            "returncode": result.returncode,
            "ok": result.returncode == 0,
            "issue": issue,  # may be None if the re-run cleared it
            "stderr": result.stderr[-1500:] if result.returncode != 0 else "",
        })


class IssueAckView(_AdminView):
    def post(self, request, issue_id):
        guard = self._guard(request)
        if guard:
            return guard
        status_value = str(request.data.get("status") or "").strip()
        valid = {c for c, _ in SystemIssueAck.STATUS_CHOICES}
        if status_value not in valid:
            return Response({"detail": f"status must be one of {sorted(valid)}."}, status=400)

        issue = find_issue(issue_id, request)
        if issue is None:
            return Response({"detail": "Issue not found or already cleared."}, status=404)

        ack, _ = SystemIssueAck.objects.update_or_create(
            issue_key=issue_id, fingerprint=issue["fingerprint"],
            defaults={
                "status": status_value,
                "note": str(request.data.get("note") or "").strip(),
                "acknowledged_by": request.user,
                "acknowledged_by_username": getattr(request.user, "username", "") or "",
            },
        )
        record_audit_event(
            action="update", request=request, object_type="system_issue", object_id=issue_id,
            description=f"Issue {issue_id} marked {status_value}.",
            metadata={"fingerprint": issue["fingerprint"]},
        )
        issue["status"] = ack.status
        issue["note"] = ack.note
        issue["acknowledged_by"] = ack.acknowledged_by_username
        return Response(issue)
