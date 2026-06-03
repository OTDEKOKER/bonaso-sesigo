"""Custom middleware for the BONASO Data Portal."""

from __future__ import annotations


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
