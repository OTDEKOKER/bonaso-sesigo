"""Canonical performance (RAG) classification — the single source of truth.

Backend mirror of the frontend ``components/dashboard/engine/performance-status.ts``.
Every backend surface that turns an achievement-% into a status/verdict MUST go
through here so the dashboard, executive view, funder reports, management
intelligence and reports hub all agree on one vocabulary and one set of bands.

Bands (mirror the dashboard prototype exactly):
    >= 100  met
    >=  75  on-track
    >=  50  at-risk
    <   50  off-track
    no target / not computable -> untargeted

Status strings are hyphenated to match the frontend ``PerformanceStatus`` type
verbatim, so a value can cross the API boundary and be rendered by the shared
frontend labels/colours without a translation table.
"""
from __future__ import annotations

MET = "met"
ON_TRACK = "on-track"
AT_RISK = "at-risk"
OFF_TRACK = "off-track"
UNTARGETED = "untargeted"

# Ordered worst-last for a real target-vs-achieved comparison (excludes untargeted).
PERFORMANCE_RAG_ORDER = [MET, ON_TRACK, AT_RISK, OFF_TRACK]
PERFORMANCE_STATUS_ORDER = [MET, ON_TRACK, AT_RISK, OFF_TRACK, UNTARGETED]

PERFORMANCE_STATUS_LABELS = {
    MET: "Met",
    ON_TRACK: "On track",
    AT_RISK: "At risk",
    OFF_TRACK: "Off track",
    UNTARGETED: "No target",
}


def classify_performance(achievement_percent, *, targeted: bool = True) -> str:
    """achievement-% -> canonical status. ``None``/non-numeric/untargeted -> untargeted."""
    if not targeted or achievement_percent is None:
        return UNTARGETED
    try:
        pct = float(achievement_percent)
    except (TypeError, ValueError):
        return UNTARGETED
    if pct != pct:  # NaN
        return UNTARGETED
    if pct >= 100:
        return MET
    if pct >= 75:
        return ON_TRACK
    if pct >= 50:
        return AT_RISK
    return OFF_TRACK


def performance_label(status: str) -> str:
    return PERFORMANCE_STATUS_LABELS.get(status, PERFORMANCE_STATUS_LABELS[UNTARGETED])


def needs_attention(achievement_percent) -> bool:
    """True when a targeted metric is below on-track (at-risk or off-track)."""
    return classify_performance(achievement_percent) in {AT_RISK, OFF_TRACK}
