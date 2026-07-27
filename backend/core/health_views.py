"""Lightweight, unauthenticated liveness/readiness endpoint for container health
checks and the edge (audit WS3).

Deliberately minimal and safe to expose:
  * no authentication (it must answer before/without a session);
  * NO secrets, versions, settings or infrastructure detail in the body — just a
    status string and a boolean DB flag, so it cannot be used for fingerprinting;
  * a cheap ``SELECT 1`` to confirm the database socket is actually usable, so a
    process that is up but cannot reach Postgres is reported unhealthy (503).
"""
from __future__ import annotations

from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    # Health checks must never be throttled or they will flap under load.
    throttle_classes: list = []

    def get(self, request):
        db_ok = True
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
                cursor.fetchone()
        except Exception:
            db_ok = False
        status_code = 200 if db_ok else 503
        return Response({'status': 'ok' if db_ok else 'degraded', 'database': db_ok},
                        status=status_code)
