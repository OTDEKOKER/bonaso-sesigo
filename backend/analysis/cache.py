"""Scope-safe, short-TTL cache for expensive read-only analytics responses.

Generalises the proven message-analytics cache key (see
``analysis.views._build_message_analytics_cache_key``) into a reusable helper.

Leak safety — the whole point in a multi-tenant, PII-bearing, live/training
system. Every entry is keyed by:

  * the authenticated **user id** — which fully determines their organization
    scope, role and module permissions (so user A can never read user B's data);
  * the resolved **live/training mode** (so a live request can never be served a
    training-cached payload, or vice versa);
  * the exact request **query string** — project, coordinator, organization, date
    and every other filter (so different views never collide).

Two requests therefore share an entry ONLY when they would compute an identical
response. TTL is short, so a newly-approved aggregate or a permission change is
reflected quickly without explicit invalidation.

Under the test runner the cache is skipped entirely: the persistent filesystem
cache is shared across unrelated test cases (and other runs on the host), which
would cross-contaminate responses between tests. The wrapped endpoint then
always computes fresh.
"""
from __future__ import annotations

import hashlib
from typing import Callable
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache
from rest_framework.response import Response

from organizations.access import training_view_mode

DEFAULT_ANALYTICS_CACHE_TTL_SECONDS = 60


def _query_signature(request) -> str:
    """Order-independent signature of the full (multi-valued) query string."""
    items = sorted((key, sorted(values)) for key, values in request.query_params.lists())
    return urlencode(items, doseq=True)


def build_scoped_cache_key(request, scope_tag: str) -> str:
    user_id = getattr(getattr(request, "user", None), "id", None) or 0
    key_source = "|".join(
        [
            f"tag:{scope_tag}",
            f"user:{user_id}",
            f"mode:{training_view_mode(request)}",
            f"query:{_query_signature(request)}",
        ]
    )
    digest = hashlib.sha1(key_source.encode("utf-8")).hexdigest()
    return f"analysis:scoped:v1:{scope_tag}:{digest}"


def cached_analytics_response(
    request,
    scope_tag: str,
    produce: Callable[[], object],
    *,
    ttl: int = DEFAULT_ANALYTICS_CACHE_TTL_SECONDS,
) -> Response:
    """Return a DRF ``Response`` for ``produce()``, cached leak-safely by
    (user, mode, query). ``produce`` returns the serializable payload (dict/list)
    and MUST be called only after all validation / permission checks have passed
    — never cache an error path.

    The cache is bypassed under the test runner so tests never observe a
    stale/shared payload.
    """
    if getattr(settings, "TESTING", False):
        return Response(produce())

    key = build_scoped_cache_key(request, scope_tag)
    cached = cache.get(key)
    if cached is not None:
        return Response(cached)

    payload = produce()
    cache.set(key, payload, timeout=ttl)
    return Response(payload)
