"""Idempotency support for DRF viewsets (OFF-1).

Apply :class:`IdempotentMutationMixin` to any ``ModelViewSet`` whose create
(and optionally update) operations are replayed by the offline sync queue. When
the request carries an ``X-Idempotency-Key`` header the mixin guarantees the
underlying write happens at most once per (user, key): the first request runs
normally and its response is recorded; every later replay returns that recorded
response without touching the database again.
"""
from __future__ import annotations

import hashlib
import json

from django.db import IntegrityError, transaction
from django.core.serializers.json import DjangoJSONEncoder
from rest_framework import status
from rest_framework.response import Response

from .models import IdempotencyKey

IDEMPOTENCY_HEADER = 'HTTP_X_IDEMPOTENCY_KEY'
MAX_KEY_LENGTH = 255


def _extract_key(request) -> str:
    raw = request.META.get(IDEMPOTENCY_HEADER) or ''
    return raw.strip()[:MAX_KEY_LENGTH]


def _request_hash(request) -> str:
    body = request.body if hasattr(request, 'body') else b''
    if isinstance(body, str):
        body = body.encode('utf-8', 'ignore')
    return hashlib.sha256(body or b'').hexdigest()


def _serialise_body(data):
    """Best-effort JSON-safe copy of a DRF response body for later replay."""
    try:
        return json.loads(json.dumps(data, cls=DjangoJSONEncoder))
    except (TypeError, ValueError):
        return None


class IdempotentMutationMixin:
    # Methods whose handlers are protected. POST (create) is the one that
    # produces duplicate ROWS on replay; updates are naturally idempotent but
    # can be added here if exact-response replay is desired.
    IDEMPOTENT_METHODS = {'POST'}

    def _idempotent_dispatch(self, request, super_handler, *args, **kwargs):
        if request.method not in self.IDEMPOTENT_METHODS:
            return super_handler(request, *args, **kwargs)

        key = _extract_key(request)
        if not key:
            # No key supplied (online request) -> behave exactly as before.
            return super_handler(request, *args, **kwargs)

        user = request.user if getattr(request, 'user', None) and request.user.is_authenticated else None
        path = request.path[:MAX_KEY_LENGTH]
        req_hash = _request_hash(request)

        # 1. Atomically claim the key. If it already exists this is a replay.
        try:
            with transaction.atomic():
                record = IdempotencyKey.objects.create(
                    key=key, user=user, method=request.method,
                    path=path, request_hash=req_hash,
                )
            claimed = True
        except IntegrityError:
            record = IdempotencyKey.objects.filter(user=user, key=key).first()
            claimed = False
            if record is None:
                # Lost the race but row vanished; fall back to a normal write.
                return super_handler(request, *args, **kwargs)

        # 2. Replay path: key already seen.
        if not claimed:
            if record.request_hash and record.request_hash != req_hash:
                return Response(
                    {'detail': 'Idempotency-Key reused with a different request payload.'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            if record.completed:
                return Response(record.response_body, status=record.status_code or status.HTTP_200_OK)
            # Original request is still in flight in another worker.
            return Response(
                {'detail': 'A request with this Idempotency-Key is still being processed.'},
                status=status.HTTP_409_CONFLICT,
            )

        # 3. First time we have seen this key: run the real handler.
        try:
            response = super_handler(request, *args, **kwargs)
        except Exception:
            # Don't leave a poisoned claim behind; let a later replay retry.
            IdempotencyKey.objects.filter(pk=record.pk, completed=False).delete()
            raise

        # 4. Persist the outcome only for successful writes so failures (4xx/5xx)
        #    can be legitimately retried.
        if 200 <= response.status_code < 300:
            record.status_code = response.status_code
            record.response_body = _serialise_body(getattr(response, 'data', None))
            record.completed = True
            record.save(update_fields=['status_code', 'response_body', 'completed', 'updated_at'])
        else:
            IdempotencyKey.objects.filter(pk=record.pk, completed=False).delete()

        return response

    def create(self, request, *args, **kwargs):
        return self._idempotent_dispatch(request, super().create, *args, **kwargs)
