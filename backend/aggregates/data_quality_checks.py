"""Database-aware Data Quality checks + flag/score persistence.

Consumes the pure :mod:`aggregates.data_quality` engine and the live tables to:
  * detect consistency / anomaly / duplicate / fact-integrity / completeness issues,
  * raise them as reviewable ``flags.Flag`` rows (idempotent, with resolution
    tracking already on the Flag model), and
  * compute + snapshot ``DataQualityScore`` rows for the dashboard rankings/trends.

Nothing here mutates aggregate VALUES or blocks reporting — it only observes and
flags. LIVE/TRAINING isolation is honoured via ``Project.is_training``.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from django.db.models import Sum
from django.utils import timezone

from flags.models import Flag
from indicators.canonical import canonical_id_map
from organizations.models import Organization
from projects.models import Project

from . import data_quality as dq
from .facts import flatten_value
from .models import Aggregate, AggregateFact, DataQualityScore


# ── Flag persistence (idempotent) ─────────────────────────────────────────────
def upsert_dq_flag(*, category, aggregate, severity, title, description, details,
                   run_label="", actor=None) -> Flag:
    """Create or refresh an OPEN data-quality flag for one aggregate + category.

    Re-running a check never duplicates a still-open flag — it refreshes the
    severity/details. Resolved flags are left alone (history preserved).
    """
    existing = next(
        (
            f for f in Flag.objects.filter(
                flag_type="data_quality", content_type="aggregate",
                object_id=aggregate.id, status="open",
            )
            if (f.metadata or {}).get("category") == category
        ),
        None,
    )
    metadata = {**details, "category": category, "severity": severity, "run_label": run_label}
    if existing is not None:
        existing.priority = severity if severity in {"low", "medium", "high", "critical"} else "medium"
        existing.description = description
        existing.metadata = metadata
        existing.save(update_fields=["priority", "description", "metadata", "updated_at"])
        return existing
    return Flag.objects.create(
        flag_type="data_quality", status="open",
        priority=severity if severity in {"low", "medium", "high", "critical"} else "medium",
        title=title, description=description,
        content_type="aggregate", object_id=aggregate.id,
        organization=aggregate.organization, created_by=actor, metadata=metadata,
    )


def _base_aggregates(mode="live"):
    qs = Aggregate.objects.select_related("indicator", "organization", "project")
    if mode == "training":
        return qs.filter(project__is_training=True)
    if mode == "live":
        return qs.filter(project__is_training=False)
    return qs


# ── Phase 1: consistency ──────────────────────────────────────────────────────
def run_coherence_checks(*, mode="live", run_label="", actor=None) -> int:
    raised = 0
    for agg in _base_aggregates(mode).iterator():
        report = dq.coherence_report(agg.value)
        if not report["checked"] or report["is_coherent"]:
            continue
        upsert_dq_flag(
            category=dq.CATEGORY_CONSISTENCY, aggregate=agg, severity=report["severity"],
            title=f"Consistency: {agg.indicator.code or agg.indicator.name}",
            description=(
                f"Reported total {report['reported_total']} ≠ calculated "
                f"{report['calculated_total']} (difference {report['difference']})."
            ),
            details=report, run_label=run_label, actor=actor,
        )
        raised += 1
    return raised


# ── Phase 6: fact integrity ───────────────────────────────────────────────────
def run_fact_integrity_checks(*, mode="live", run_label="", actor=None) -> dict:
    """Verify Aggregate == AggregateFact. Detect missing facts, drifted totals,
    and orphan facts. Raises fact_integrity flags for aggregate-linked issues."""
    drift = 0
    missing = 0
    fact_totals = dict(
        AggregateFact.objects.values_list("aggregate_id")
        .annotate(total=Sum("value"))
        .values_list("aggregate_id", "total")
    )
    for agg in _base_aggregates(mode).iterator():
        expected = dq.calculated_total(agg.value)
        leaves = flatten_value(agg.value)
        fact_total = fact_totals.get(agg.id)
        if leaves and fact_total is None:
            missing += 1
            upsert_dq_flag(
                category=dq.CATEGORY_FACT_INTEGRITY, aggregate=agg, severity=dq.SEVERITY_HIGH,
                title=f"Fact integrity: missing facts ({agg.indicator.code or agg.indicator.name})",
                description="Aggregate has numeric leaves but no AggregateFact rows (sync failure).",
                details={"expected_total": float(expected), "fact_total": None},
                run_label=run_label, actor=actor,
            )
        elif fact_total is not None and abs(float(fact_total) - float(expected)) > 0.0001:
            drift += 1
            upsert_dq_flag(
                category=dq.CATEGORY_FACT_INTEGRITY, aggregate=agg, severity=dq.SEVERITY_HIGH,
                title=f"Fact integrity: total drift ({agg.indicator.code or agg.indicator.name})",
                description=f"AggregateFact sum {float(fact_total)} ≠ value total {float(expected)}.",
                details={"expected_total": float(expected), "fact_total": float(fact_total)},
                run_label=run_label, actor=actor,
            )
    # Orphan facts (aggregate deleted but facts remain) — counted, not per-row flagged.
    live_ids = set(_base_aggregates(mode).values_list("id", flat=True))
    orphans = (
        AggregateFact.objects.exclude(aggregate_id__in=live_ids).count()
        if mode == "all" else
        0  # mode-scoped orphan detection is handled by the all-mode run
    )
    return {"drift": drift, "missing": missing, "orphans": orphans}


# ── Phase 3: anomaly detection ────────────────────────────────────────────────
def run_anomaly_checks(*, mode="live", run_label="", actor=None) -> int:
    """Detect spike/decline/zero-after-activity per (canonical indicator, org)
    across the APPROVED period series."""
    id_map = canonical_id_map()
    series = defaultdict(list)   # (canonical_id, org_id) -> [(period_start, agg)]
    for agg in _base_aggregates(mode).filter(status="approved").iterator():
        canon = id_map.get(agg.indicator_id, agg.indicator_id)
        series[(canon, agg.organization_id)].append((agg.period_start, agg))
    raised = 0
    for points in series.values():
        points.sort(key=lambda t: t[0])
        labels_totals = [(str(ps), float(dq.calculated_total(a.value) or dq.reported_total(a.value) or 0)) for ps, a in points]
        anomalies = dq.detect_series_anomalies(labels_totals)
        if not anomalies:
            continue
        last_agg = points[-1][1]
        worst = max(anomalies, key=lambda a: ["low", "medium", "high", "critical"].index(a.severity))
        upsert_dq_flag(
            category=dq.CATEGORY_ANOMALY, aggregate=last_agg, severity=worst.severity,
            title=f"Anomaly: {last_agg.indicator.code or last_agg.indicator.name}",
            description="; ".join(a.detail for a in anomalies[-3:]),
            details={"anomalies": [a.as_dict() for a in anomalies]},
            run_label=run_label, actor=actor,
        )
        raised += 1
    return raised


# ── Phase 3: duplicate pattern detection ──────────────────────────────────────
def run_duplicate_checks(*, mode="live", run_label="", actor=None) -> int:
    """Flag identical non-trivial value breakdowns reused across different
    (indicator, org, period) records — a copy-paste signal at portfolio scale."""
    by_sig = defaultdict(list)
    for agg in _base_aggregates(mode).iterator():
        if getattr(agg, "copy_paste_verified", False):
            continue
        sig = dq.value_signature(agg.value)
        # Ignore trivial single-number signatures (too common to be suspicious).
        if sig and ";" in sig:
            by_sig[sig].append(agg)
    raised = 0
    for sig, aggs in by_sig.items():
        distinct_keys = {(a.indicator_id, a.organization_id, a.period_start) for a in aggs}
        if len(distinct_keys) < 2:
            continue  # same record re-saved is not a duplicate pattern
        for agg in aggs:
            upsert_dq_flag(
                category=dq.CATEGORY_DUPLICATE, aggregate=agg, severity=dq.SEVERITY_MEDIUM,
                title=f"Duplicate pattern: {agg.indicator.code or agg.indicator.name}",
                description=f"Identical breakdown appears in {len(distinct_keys)} distinct records.",
                details={"signature_count": len(distinct_keys)},
                run_label=run_label, actor=actor,
            )
            raised += 1
    return raised


# ── Phase 2: scoring ──────────────────────────────────────────────────────────
def _open_flag_counts(mode):
    """{organization_id: {category: count}} of OPEN data-quality flags."""
    counts = defaultdict(lambda: defaultdict(int))
    for f in Flag.objects.filter(flag_type="data_quality", status="open").select_related("organization"):
        counts[f.organization_id][(f.metadata or {}).get("category", "other")] += 1
    return counts


def compute_and_store_scores(*, mode="live", run_label="") -> list[DataQualityScore]:
    """Compute + snapshot a quality score per organization (and project rollups).

    Factors (0-100): consistency (fewer consistency/fact flags), review (fewer
    flagged/rejected), duplicate (fewer duplicate flags), timeliness + completeness
    (approval ratio as a proxy until expected-submission schedules are modelled).
    """
    flag_counts = _open_flag_counts(mode)
    aggs = list(_base_aggregates(mode).values("organization_id", "project_id", "status"))
    by_org = defaultdict(list)
    for row in aggs:
        by_org[row["organization_id"]].append(row)

    org_names = dict(Organization.objects.values_list("id", "name"))
    snapshots = []
    for org_id, rows in by_org.items():
        total = len(rows)
        approved = sum(1 for r in rows if r["status"] == "approved")
        flagged = sum(1 for r in rows if r["status"] in ("flagged", "rejected"))
        fc = flag_counts.get(org_id, {})
        consistency_bad = fc.get("consistency", 0) + fc.get("fact_integrity", 0)
        result = dq.score_from_factors(
            completeness=dq.ratio_score(approved, total),
            consistency=dq.ratio_score(max(0, total - consistency_bad), total),
            timeliness=dq.ratio_score(approved, total),
            review=dq.ratio_score(max(0, total - flagged), total),
            duplicate=dq.ratio_score(max(0, total - fc.get("duplicate", 0)), total),
        )
        snapshots.append(DataQualityScore(
            scope_type="organization", scope_id=org_id, scope_label=org_names.get(org_id, str(org_id)),
            mode=mode if mode in ("live", "training") else "live",
            score=result["score"], label=result["label"], factors=result["factors"],
            details={"total": total, "approved": approved, "flagged": flagged, "flags": dict(fc)},
            run_label=run_label,
        ))
    if snapshots:
        DataQualityScore.objects.bulk_create(snapshots, batch_size=200)
    return snapshots


# ── Phase 4: parity report → Data Quality classification ──────────────────────
# Maps a monthly parity result onto DQ categories. Value mismatches are the most
# severe (real disagreement); missing-in-db is a completeness backlog; missing-in-
# workbook is a traceability gap.
_PARITY_MAP = {
    "payload_mismatches": (dq.CATEGORY_CONSISTENCY, dq.SEVERITY_HIGH, "value mismatch"),
    "missing_in_db": (dq.CATEGORY_MISSING, dq.SEVERITY_MEDIUM, "workbook record missing in the database"),
    "missing_in_workbook": (dq.CATEGORY_TRACEABILITY, dq.SEVERITY_LOW, "database record missing from the workbook"),
}


def upsert_org_dq_flag(*, category, organization_id, severity, title, description,
                       details, run_label="", actor=None):
    """Create/refresh an OPEN org-level data-quality flag (no aggregate to attach
    to — parity gaps reference a missing record). Idempotent per (org, category,
    source). When the count is 0, any standing flag is auto-resolved."""
    existing = next(
        (
            f for f in Flag.objects.filter(
                flag_type="data_quality", content_type="organization",
                object_id=organization_id, status="open",
            )
            if (f.metadata or {}).get("category") == category
            and (f.metadata or {}).get("source") == "parity"
        ),
        None,
    )
    count = int(details.get("count") or 0)
    if count <= 0:
        if existing is not None:
            from django.utils import timezone
            existing.status = "resolved"
            existing.resolution_notes = "Auto-resolved: parity gap cleared."
            existing.resolved_at = timezone.now()
            existing.save(update_fields=["status", "resolution_notes", "resolved_at", "updated_at"])
        return None
    metadata = {**details, "category": category, "severity": severity, "source": "parity", "run_label": run_label}
    if existing is not None:
        existing.priority = severity
        existing.description = description
        existing.metadata = metadata
        existing.save(update_fields=["priority", "description", "metadata", "updated_at"])
        return existing
    return Flag.objects.create(
        flag_type="data_quality", status="open", priority=severity,
        title=title, description=description,
        content_type="organization", object_id=organization_id,
        organization_id=organization_id, created_by=actor, metadata=metadata,
    )


def ingest_parity_report(report: dict, *, run_label="", actor=None) -> dict:
    """Fold a monthly payload parity report into the Data Quality framework.

    Creates one org-level DQ flag per (organization, category) with a non-zero
    count. Returns counts per category. Does NOT alter the parity calculation —
    it only classifies the already-computed result.
    """
    if not isinstance(report, dict):
        return {}
    project = report.get("project") or {}
    created = {"consistency": 0, "missing": 0, "traceability": 0}
    for org in report.get("orgs", []):
        org_id = org.get("org_id")
        if not org_id:
            continue
        for key, (category, severity, label) in _PARITY_MAP.items():
            count = int(org.get(key) or 0)
            flag = upsert_org_dq_flag(
                category=category, organization_id=org_id, severity=severity,
                title=f"{category.title()}: parity {key.replace('_', ' ')}",
                description=(
                    f"{org.get('org')}: {count} {label}{'' if count == 1 else 's'} "
                    f"in the latest parity check (project {project.get('code') or project.get('id')})."
                ),
                details={"count": count, "project_id": project.get("id"),
                         "project_code": project.get("code"), "metric": key},
                run_label=run_label, actor=actor,
            )
            if flag is not None:
                created[category] = created.get(category, 0) + 1
    return created


def latest_parity_report():
    """Load the newest ``parity_*.json`` report, or ``None``."""
    import json
    from pathlib import Path

    from django.conf import settings
    parity_dir = Path(settings.BASE_DIR) / "reports" / "monthly_parity_checks"
    files = sorted(parity_dir.glob("parity_*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ── Orchestrator ──────────────────────────────────────────────────────────────
def run_all(*, mode="live", frequency="daily", actor=None) -> dict:
    run_label = f"{date.today().isoformat()}-{frequency}"
    summary = {
        "run_label": run_label, "mode": mode, "frequency": frequency,
        "started_at": timezone.now().isoformat(),
        "consistency": run_coherence_checks(mode=mode, run_label=run_label, actor=actor),
        "anomaly": run_anomaly_checks(mode=mode, run_label=run_label, actor=actor),
        "duplicate": run_duplicate_checks(mode=mode, run_label=run_label, actor=actor),
        "fact_integrity": run_fact_integrity_checks(mode=mode, run_label=run_label, actor=actor),
    }
    # Fold the latest monthly parity result into DQ classification (live only —
    # parity is a live-system check).
    if mode in ("live", "all"):
        parity = latest_parity_report()
        if parity is not None:
            summary["parity"] = ingest_parity_report(parity, run_label=run_label, actor=actor)
    if frequency in ("weekly", "monthly"):
        summary["scores"] = len(compute_and_store_scores(mode=mode, run_label=run_label))
    summary["finished_at"] = timezone.now().isoformat()
    return summary
