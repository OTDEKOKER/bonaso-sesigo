"""Cached organization-tree adjacency (kills the get_descendants N+1).

``Organization.get_descendants()`` previously recursed with one query per node,
so a single scope resolution issued dozens of queries per request. The org tree
is small and changes rarely, so the parent -> children adjacency is cached
process-wide (the shared filesystem cache, so every gunicorn worker agrees) and
invalidated on any Organization create / update / delete (see
``organizations.apps``). A short TTL backstops writes that bypass the ORM
signals (raw SQL / bulk ops).

Under the test runner the cache is skipped entirely: the persistent filesystem
cache is shared across unrelated test cases (and other runs on the host), which
would cross-contaminate the tree between tests. Rebuilding from the DB each call
is still a single query — the N+1 is gone either way — with zero staleness risk.
"""
from __future__ import annotations

from collections import defaultdict

from django.conf import settings
from django.core.cache import cache

_ADJ_CACHE_KEY = "org_tree_children_adjacency_v1"
# Backstop TTL for out-of-band writes. App-driven org edits invalidate
# immediately via the post_save / post_delete signals, so this only bounds the
# staleness window for changes made outside the ORM.
_ADJ_CACHE_TTL = 300


def _build_adjacency() -> dict[int, list[int]]:
    from .models import Organization

    built: dict[int, list[int]] = defaultdict(list)
    for org_id, parent_id in Organization.objects.values_list("id", "parent_id"):
        if parent_id is not None:
            built[int(parent_id)].append(int(org_id))
    return dict(built)


def children_adjacency() -> dict[int, list[int]]:
    """``{parent_id: [child_id, ...]}`` for the whole org tree (active or not)."""
    if getattr(settings, "TESTING", False):
        return _build_adjacency()

    adjacency = cache.get(_ADJ_CACHE_KEY)
    if adjacency is None:
        adjacency = _build_adjacency()
        cache.set(_ADJ_CACHE_KEY, adjacency, _ADJ_CACHE_TTL)
    return adjacency


def descendant_ids(org_id: int) -> list[int]:
    """All descendant org ids of ``org_id`` (excludes itself). Cycle-safe."""
    adjacency = children_adjacency()
    seen: set[int] = set()
    stack = list(adjacency.get(int(org_id), []))
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(adjacency.get(current, []))
    return list(seen)


def invalidate_org_tree_cache(*args, **kwargs) -> None:
    """Drop the cached adjacency. Wired to Organization post_save/post_delete."""
    cache.delete(_ADJ_CACHE_KEY)
