"""Data Quality engine: coherence, anomaly detection, and scoring.

Pure, dependency-free analytics over an aggregate ``value`` and an indicator's
history. No DB access here (callers supply the data) so every rule is trivially
unit-testable. Persistence + workflow live in the management command / signals /
API that consume this module.

Design rules:
  * Coherence and anomaly checks WARN — they never block a save or mutate data.
  * Sums reuse ``aggregates.facts.flatten_value`` so "the numbers" are defined in
    exactly one place (parity with rollups / the fact table).
  * Everything returns plain dicts/enums so it serialises straight to JSON for the
    Flag.metadata payload and the dashboard API.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .facts import flatten_value

# ── Severity ──────────────────────────────────────────────────────────────────
SEVERITY_LOW = "low"
SEVERITY_MEDIUM = "medium"
SEVERITY_HIGH = "high"
SEVERITY_CRITICAL = "critical"

# DQ flag categories (Phase 7). Stored on Flag.metadata["category"].
CATEGORY_CONSISTENCY = "consistency"     # value disagreement (highest severity)
CATEGORY_ANOMALY = "anomaly"
CATEGORY_DUPLICATE = "duplicate"
CATEGORY_MISSING = "missing"             # completeness: present in workbook, not in DB
CATEGORY_TRACEABILITY = "traceability"   # present in DB, not in workbook
CATEGORY_VALIDATION = "validation"
CATEGORY_FACT_INTEGRITY = "fact_integrity"

# Tunable thresholds (conservative; documented for calibration).
COHERENCE_TOLERANCE = Decimal("0.0001")   # exact-match tolerance for rounding
COHERENCE_MED_RATIO = Decimal("0.02")     # >2% mismatch → medium
COHERENCE_HIGH_RATIO = Decimal("0.10")    # >10% mismatch → high
COHERENCE_CRIT_RATIO = Decimal("0.50")    # >50% mismatch → critical

ANOMALY_MIN_BASE = Decimal("20")          # ignore tiny baselines (noise)
SPIKE_FACTOR = Decimal("5")               # current >= 5x previous → spike
DECLINE_FACTOR = Decimal("5")             # current <= previous/5 → decline


def _num(x) -> Decimal:
    try:
        return Decimal(str(x))
    except Exception:
        return Decimal(0)


# ── Phase 1: Cross-field consistency ─────────────────────────────────────────
def calculated_total(value) -> Decimal:
    """Sum of the value's numeric disaggregate leaves (single source of truth)."""
    return sum((amount for _p, _s, _b, amount in flatten_value(value)), Decimal(0))


def reported_total(value):
    """The explicitly stated total, or ``None`` when the shape carries none."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _num(value)
    if isinstance(value, dict) and value.get("total") is not None:
        return _num(value.get("total"))
    return None


def _coherence_severity(diff: Decimal, base: Decimal) -> str:
    if base <= 0:
        return SEVERITY_HIGH if diff > 0 else SEVERITY_LOW
    ratio = (diff / base).copy_abs()
    if ratio >= COHERENCE_CRIT_RATIO:
        return SEVERITY_CRITICAL
    if ratio >= COHERENCE_HIGH_RATIO:
        return SEVERITY_HIGH
    if ratio >= COHERENCE_MED_RATIO:
        return SEVERITY_MEDIUM
    return SEVERITY_LOW


def coherence_report(value) -> dict:
    """Compare the reported total to the sum of disaggregate leaves.

    Returns ``{is_coherent, reported_total, calculated_total, difference,
    severity, checked}``. ``checked`` is False when the value carries no explicit
    total OR no disaggregates (nothing to reconcile) — those are coherent by
    definition, never a warning. Handles age/sex/key-population/nested/legacy
    shapes via ``flatten_value``.
    """
    reported = reported_total(value)
    leaves = flatten_value(value)
    has_disaggregates = isinstance(value, dict) and bool(value.get("disaggregates") or value.get("male") or value.get("female"))
    if reported is None or not has_disaggregates or not leaves:
        return {"is_coherent": True, "checked": False, "reported_total": None,
                "calculated_total": None, "difference": None, "severity": SEVERITY_LOW}
    calc = sum((a for _p, _s, _b, a in leaves), Decimal(0))
    diff = (reported - calc).copy_abs()
    is_coherent = diff <= COHERENCE_TOLERANCE
    return {
        "is_coherent": is_coherent,
        "checked": True,
        "reported_total": float(reported),
        "calculated_total": float(calc),
        "difference": float(diff),
        "severity": SEVERITY_LOW if is_coherent else _coherence_severity(diff, reported),
    }


# ── Phase 3: Anomaly detection ───────────────────────────────────────────────
@dataclass
class Anomaly:
    type: str           # 'spike' | 'decline' | 'zero_after_activity' | 'duplicate'
    severity: str
    previous: float
    current: float
    detail: str

    def as_dict(self) -> dict:
        return {"type": self.type, "severity": self.severity, "previous": self.previous,
                "current": self.current, "detail": self.detail}


def detect_series_anomalies(series: list[tuple[str, float]]) -> list[Anomaly]:
    """Detect anomalies in a chronologically-ordered ``[(period_label, total)]``.

    Rules (warn-only): sudden growth (≥5x), sudden decline (≤1/5), and a zero
    following sustained activity. Tiny baselines (< ANOMALY_MIN_BASE) are ignored
    to avoid noise on near-empty indicators.
    """
    anomalies: list[Anomaly] = []
    points = [(label, _num(total)) for label, total in series]
    for i in range(1, len(points)):
        (_plabel, prev), (label, cur) = points[i - 1], points[i]
        if prev >= ANOMALY_MIN_BASE and cur >= prev * SPIKE_FACTOR:
            anomalies.append(Anomaly("spike", SEVERITY_HIGH, float(prev), float(cur),
                                     f"{label}: {cur} is ≥{SPIKE_FACTOR}× the previous {prev}"))
        elif prev >= ANOMALY_MIN_BASE and cur > 0 and cur * DECLINE_FACTOR <= prev:
            anomalies.append(Anomaly("decline", SEVERITY_HIGH, float(prev), float(cur),
                                     f"{label}: {cur} is ≤1/{DECLINE_FACTOR} of the previous {prev}"))
        elif cur == 0 and prev >= ANOMALY_MIN_BASE:
            # Zero after sustained activity (look back up to 2 periods).
            sustained = all(p >= ANOMALY_MIN_BASE for _l, p in points[max(0, i - 2):i])
            if sustained:
                anomalies.append(Anomaly("zero_after_activity", SEVERITY_CRITICAL, float(prev), 0.0,
                                         f"{label}: dropped to 0 after sustained activity (prev {prev})"))
    return anomalies


def value_signature(value) -> str:
    """Stable signature of a value's NON-ZERO numeric leaves, for cross-record
    duplicate-pattern detection (same breakdown re-used across indicators /
    periods / orgs). Empty when the value has no positive numbers."""
    parts = sorted(
        f"{p}|{s}|{b}={a.normalize()}"
        for p, s, b, a in flatten_value(value) if a != 0
    )
    return ";".join(parts)


# ── Phase 2: Data quality scoring ────────────────────────────────────────────
# Factor weights (sum = 100).
WEIGHTS = {"completeness": 30, "consistency": 25, "timeliness": 15,
           "review": 15, "duplicate": 15}


def quality_label(score: float) -> str:
    if score >= 90:
        return "Excellent"
    if score >= 75:
        return "Good"
    if score >= 55:
        return "Needs Attention"
    return "Poor"


def score_from_factors(*, completeness: float, consistency: float, timeliness: float,
                       review: float, duplicate: float) -> dict:
    """Blend five 0-100 factor scores into one weighted 0-100 quality score."""
    factors = {"completeness": completeness, "consistency": consistency,
               "timeliness": timeliness, "review": review, "duplicate": duplicate}
    clamped = {k: max(0.0, min(100.0, float(v))) for k, v in factors.items()}
    total_weight = sum(WEIGHTS.values())
    score = sum(clamped[k] * WEIGHTS[k] for k in WEIGHTS) / total_weight
    score = round(score, 1)
    return {"score": score, "label": quality_label(score), "factors": clamped, "weights": dict(WEIGHTS)}


def ratio_score(good: int, total: int) -> float:
    """A 0-100 score = good/total (100 when nothing to judge)."""
    if total <= 0:
        return 100.0
    return round(100.0 * good / total, 1)
