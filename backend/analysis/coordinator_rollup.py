"""Backward-compatible shim.

The certified coordinator rollup engine now lives in
``analysis.services.coordinator_rollups`` (the single source of truth used by the
Targets page, analytics, dashboards, exports, and future reporting APIs). This
module is retained only so older imports keep working; do not add logic here.
"""
from __future__ import annotations

from analysis.services.coordinator_rollups import (  # noqa: F401
    aggregate_total,
    compute_target_actuals,
    fiscal_quarter_range,
    get_coordinator_actuals,
    get_coordinator_performance,
    get_coordinator_targets,
    performance_status,
)

__all__ = [
    'aggregate_total',
    'compute_target_actuals',
    'fiscal_quarter_range',
    'get_coordinator_actuals',
    'get_coordinator_performance',
    'get_coordinator_targets',
    'performance_status',
]
