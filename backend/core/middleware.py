"""Custom middleware for the BONASO Data Portal."""

from __future__ import annotations

from django.conf import settings


class ContentSecurityPolicyMiddleware:
    """Emit a Content-Security-Policy header on Django-served responses (S1).

    This covers the surfaces Django actually serves — the Django admin and any
    error/HTML pages — so a stored/reflected script cannot execute there. (The
    Next.js app pages are served by the frontend container, not Django; their
    CSP is configured separately in the frontend, see ``next.config``.)

    SAFETY / rollout: the policy is **disabled by default**. It only emits a
    header when ``settings.CONTENT_SECURITY_POLICY`` is a non-empty string, so
    shipping this middleware changes nothing until an operator opts in with a
    tested policy. Set ``CONTENT_SECURITY_POLICY_REPORT_ONLY=True`` first to use
    the ``-Report-Only`` variant (browsers report violations without blocking),
    watch the reports, then switch to enforcing. A view that sets its own CSP
    header is never overridden.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.policy = (getattr(settings, 'CONTENT_SECURITY_POLICY', '') or '').strip()
        report_only = bool(getattr(settings, 'CONTENT_SECURITY_POLICY_REPORT_ONLY', False))
        self.header_name = (
            'Content-Security-Policy-Report-Only' if report_only
            else 'Content-Security-Policy'
        )

    def __call__(self, request):
        response = self.get_response(request)
        if not self.policy:
            return response
        # Don't clobber an explicit per-view/per-response decision.
        if response.has_header('Content-Security-Policy') or response.has_header(
            'Content-Security-Policy-Report-Only'
        ):
            return response
        response[self.header_name] = self.policy
        return response


class ApiCacheControlMiddleware:
    """Stop authenticated API data being cached by shared proxies/browsers.

    Audit finding H3. All `/api/` responses are marked `private` so that no
    shared/intermediary cache stores them. Endpoints that expose personal data
    (respondents) additionally get `no-store`, which also prevents the offline
    service worker from persisting them to disk. Aggregate/analysis endpoints
    are intentionally left merely `private` so the offline app can still cache
    de-identified, aggregated data for field use.
    """

    # Path fragments (after /api) whose responses must never be stored at all.
    NO_STORE_PREFIXES = (
        # Individual-level data collection lives under /api/record/
        # (respondents, interactions, responses) — all PII-bearing.
        "/record",
        "/respondents",
        "/interactions",
        "/users",
        "/profiles",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path or ""
        if not path.startswith("/api/"):
            return response

        # Never override an explicit decision a view already made.
        if response.has_header("Cache-Control"):
            return response

        sub_path = path[len("/api"):]
        if any(sub_path.startswith(p) for p in self.NO_STORE_PREFIXES):
            response["Cache-Control"] = "private, no-store, max-age=0"
        else:
            response["Cache-Control"] = "private"
        return response
