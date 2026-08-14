"""Management-intelligence composition service.

ONE project+period-scoped payload that composes the existing single-sources-of-
truth into decision-ready "cards" answering the five management questions:

  1. What happened?   approved actual (coordinator_rollups)
  2. Where?           per-sub / own contribution split (coordinator_rollups)
  3. Why it matters?  effective target + achievement % (derived-target engine)
  4. Needs attention? open flags + reporting-window state + non-submission
  5. Action?          a data-grounded recommendation (never invented)

Read-only. Composes; never recomputes totals (coordinator_rollups is the SSoT)
and never sums unapproved data. Every card carries a data-state qualifier so a
reported zero is never confused with 'not reported' (see AUDIT data-state table).
"""
from __future__ import annotations

from datetime import date

from django.utils import timezone

from analysis.models import CoordinatorTarget
from analysis.services.coordinator_rollups import (
    fiscal_quarter_range,
    get_coordinator_performance,
)
from aggregates import reporting_control
from flags.models import Flag
from projects.models import ProjectOrganization
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
from analysis.services.performance_status import classify_performance

# achievement-% → canonical RAG status. Delegates to the single source of truth
# (analysis.services.performance_status) so this surface agrees with the
# dashboard, executive view, funder reports and reports hub — same bands
# (100/75/50), same vocabulary (met/on-track/at-risk/off-track/untargeted).
def pace_status(achievement_percent: float | None) -> str:
    return classify_performance(achievement_percent)


_QUARTER_ORDER = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}


def _fmt(n: float | int | None) -> str:
    if n is None:
        return "—"
    return f"{round(float(n)):,}"


def _pick_representative(perf_rows: list[dict]) -> dict | None:
    """Management-by-exception: the coordinator's most off-track measured target
    (lowest achievement with real data); else the largest-target row; else None."""
    measured = [r for r in perf_rows if r["achievement_percent"] is not None]
    if measured:
        return min(measured, key=lambda r: r["achievement_percent"])
    with_target = [r for r in perf_rows if (r["target_value"] or 0) > 0]
    if with_target:
        return max(with_target, key=lambda r: r["target_value"])
    return perf_rows[0] if perf_rows else None


def build_coordinator_cards(project, year: int, quarter: str, *, coordinator_ids=None):
    """Return one intelligence card per coordinator for the project+quarter.

    ``coordinator_ids`` (from the caller's permission scope) restricts which
    coordinators are returned — the endpoint passes the user's allowed set so no
    cross-coordinator leakage occurs.
    """
    q_start, q_end = fiscal_quarter_range(year, quarter)

    # Reporting-window state for this period (open / closed / late / missing).
    window = reporting_control.evaluate_window(project, q_start, q_end)
    window_state = getattr(window, "state", None)

    # Only ACTUAL coordinators get a card (the coordinator-target table also
    # holds sub-grantee rows). Further restrict to the caller's permission scope.
    coord_org_ids = set(
        ProjectOrganization.objects.filter(
            project_id=project.id, is_coordinator=True,
        ).values_list("organization_id", flat=True)
    )
    if coordinator_ids is not None:
        coord_org_ids &= set(coordinator_ids)

    targets = [
        t for t in CoordinatorTarget.objects.filter(
            project_id=project.id, year=year, quarter=quarter, is_active=True,
        ).select_related("coordinator", "indicator")
        if t.coordinator_id in coord_org_ids
    ]

    perf = get_coordinator_performance(targets)  # {target_id: record}

    # group this quarter's targets by coordinator
    by_coord: dict[int, list[dict]] = {}
    coord_name: dict[int, str] = {}
    target_of: dict[int, CoordinatorTarget] = {}
    for t in targets:
        rec = dict(perf.get(t.id, {}))
        rec["_target_id"] = t.id
        rec["_indicator_id"] = t.indicator_id
        rec["_indicator_label"] = t.indicator.name or t.indicator.code
        rec["_coordinator_id"] = t.coordinator_id
        by_coord.setdefault(t.coordinator_id, []).append(rec)
        coord_name[t.coordinator_id] = t.coordinator.name
        target_of[t.id] = t

    cards = []
    for coord_id, rows in by_coord.items():
        rep = _pick_representative(rows)
        if rep is None:
            continue
        indicator_id = rep["_indicator_id"]
        indicator_label = rep["_indicator_label"]
        actual = rep.get("actual_value", 0.0)
        target_value = rep.get("target_value")
        achievement = rep.get("achievement_percent")
        pending = rep.get("target_pending", False)

        card = {
            "coordinator_id": coord_id,
            "coordinator_name": coord_name.get(coord_id, f"Organization {coord_id}"),
            "indicator_id": indicator_id,
            "indicator_label": indicator_label,
            "period": f"{quarter} {year}/{str(year + 1)[-2:]}",
            "actual": actual,
            "effective_target": target_value if target_value is not None else 0.0,
            "pct_of_target": achievement,
            "pace_status": pace_status(achievement),
            "trend": _trend_for(project, coord_id, indicator_id, year, quarter),
            "where": _where_for(rep),
            "attention": _attention_for(project, coord_id, indicator_id, rep, window, q_start, q_end),
            "data_state": _data_state(rep, actual, pending),
        }
        card["delta_vs_prior_pct"] = _delta_vs_prior(card["trend"])
        card.update(_interpret(card, rep, window_state, project, year, quarter))
        cards.append(card)

    cards.sort(key=lambda c: (c["pct_of_target"] is None, c["pct_of_target"] if c["pct_of_target"] is not None else 0))
    return {
        "project": {"id": project.id, "code": project.code, "name": project.name},
        "period": {
            "year": year, "quarter": quarter,
            "label": f"{quarter} {year}/{str(year + 1)[-2:]}",
            "window_state": window_state,
        },
        "lens": "coordinator",
        "generated_at": timezone.now().isoformat(),
        "cards": cards,
    }


def _where_for(rep: dict) -> list[dict]:
    """Own + per-sub contributions (already computed, approved-only)."""
    where = []
    own = rep.get("own_contribution", 0.0)
    if own:
        where.append({"name": "Own (coordinator)", "value": own, "share_percent": None})
    for child in rep.get("child_contributions", []) or []:
        where.append({
            "name": child["organization_name"],
            "value": child["actual_value"],
            "share_percent": child.get("share_percent"),
        })
    return where


def _trend_for(project, coordinator_id, indicator_id, year, quarter) -> list[dict]:
    """Actual vs target across this fiscal year's quarters up to the current one."""
    upto = _QUARTER_ORDER.get(quarter, 4)
    q_targets = list(
        CoordinatorTarget.objects.filter(
            project_id=project.id, coordinator_id=coordinator_id,
            indicator_id=indicator_id, year=year, is_active=True,
        ).select_related("indicator")
    )
    q_targets = [t for t in q_targets if _QUARTER_ORDER.get(t.quarter, 0) <= upto]
    perf = get_coordinator_performance(q_targets)
    points = []
    for t in sorted(q_targets, key=lambda x: _QUARTER_ORDER.get(x.quarter, 0)):
        rec = perf.get(t.id, {})
        points.append({
            "period": t.quarter,
            "actual": rec.get("actual_value", 0.0),
            "target": rec.get("target_value"),
        })
    return points


def _delta_vs_prior(trend: list[dict]) -> float | None:
    if len(trend) < 2:
        return None
    prev, curr = trend[-2]["actual"], trend[-1]["actual"]
    if not prev:
        return None
    return (curr - prev) / prev * 100.0


def _attention_for(project, coordinator_id, indicator_id, rep, window, q_start, q_end) -> list[dict]:
    items: list[dict] = []
    achievement = rep.get("achievement_percent")

    # under-pace: below the canonical on-track band (at-risk/off-track = < 75).
    if achievement is not None and achievement < 75:
        sev = "critical" if achievement < 50 else "high"
        items.append({"severity": sev, "source": "target",
                      "label": f"{round(achievement)}% of quarterly target"})
    elif rep.get("target_pending"):
        items.append({"severity": "medium", "source": "target",
                      "label": "Derived target pending — source indicator not yet reported"})

    # reporting window — 'late' means past close but still accepting (attention)
    state = getattr(window, "state", None)
    if state == "late":
        items.append({"severity": "high", "source": "reporting",
                      "label": "Reporting window past close (late submissions active)"})

    # open flags across the coordinator's org subtree
    scope = resolve_organization_scope_with_project_hierarchy(coordinator_id, project_id=project.id)
    open_flags = Flag.objects.filter(organization_id__in=scope, status="open").count()
    if open_flags:
        items.append({"severity": "medium", "source": "flag",
                      "label": f"{open_flags} open flag{'s' if open_flags != 1 else ''} in this coordinator's data"})

    # sub-grantees with no contribution this quarter (non-submission signal)
    contributing = {c["organization_id"] for c in (rep.get("child_contributions") or [])}
    silent = len(scope) - len(contributing) - 1  # minus the coordinator itself
    if silent > 0 and rep.get("actual_value"):
        items.append({"severity": "medium", "source": "reporting",
                      "label": f"{silent} sub-grantee(s) with no approved data this quarter"})
    return items


def _data_state(rep: dict, actual: float, pending: bool) -> str:
    if pending:
        return "target_pending"
    if not rep.get("child_contributions") and not rep.get("own_contribution"):
        return "not_reported"
    if actual == 0:
        return "zero_reported"
    return "approved"


def _interpret(card: dict, rep: dict, window_state, project, year, quarter) -> dict:
    """Data-grounded finding + evidence + DQ qualifier + action + drill-down.
    Language mirrors the funder report; every claim traces to a computed number."""
    name = card["coordinator_name"]
    ind = card["indicator_label"]
    actual = card["actual"]
    pct = card["pct_of_target"]
    where = card["where"]

    if card["data_state"] == "not_reported":
        finding = f"{name} has no approved data for '{ind}' this period."
    elif pct is None:
        finding = f"{name} reported {_fmt(actual)} for '{ind}' (no comparable target)."
    else:
        verb = "exceeded" if pct >= 100 else "reached"
        finding = f"{name} {verb} {round(pct)}% of the '{ind}' target ({_fmt(actual)} of {_fmt(card['effective_target'])})."

    evidence = []
    top = max((w for w in where if w["name"] != "Own (coordinator)"), key=lambda w: w["value"], default=None)
    if top and top.get("share_percent"):
        evidence.append(f"{top['name']} contributed {round(top['share_percent'])}% ({_fmt(top['value'])}).")
    if card["delta_vs_prior_pct"] is not None:
        d = card["delta_vs_prior_pct"]
        evidence.append(f"{'+' if d >= 0 else ''}{round(d)}% vs the prior quarter.")

    dq = {
        "approved": "Based on approved data only.",
        "zero_reported": "A reported zero (submitted and approved), not missing data.",
        "not_reported": "No approved submissions — treat as a reporting gap, not a true zero.",
        "target_pending": "Derived target still pending; achievement not yet computable.",
    }[card["data_state"]]
    if window_state in ("late", "closed", "not_elapsed", "draft", "scheduled"):
        dq += f" Reporting window is {str(window_state).replace('_', ' ')}."

    if card["data_state"] == "not_reported":
        action = f"Follow up with {name} to submit and approve '{ind}' for this period."
    elif pct is not None and pct < 75:
        action = f"Review {name}'s delivery of '{ind}' — {round(pct)}% of target; check commodities, referrals and non-reporting sub-grantees."
    elif any(a["source"] == "flag" for a in card["attention"]):
        action = f"Resolve the open data-quality flags in {name}'s data before period close."
    else:
        action = f"On track — maintain {name}'s approach for '{ind}'."

    return {
        "finding": finding,
        "evidence": evidence,
        "dq_qualifier": dq,
        "recommended_action": action,
        "drilldown": {
            "type": "coordinator_target",
            "project": project.id,
            "coordinator": card["coordinator_id"],
            "indicator": card["indicator_id"],
            "year": year, "quarter": quarter,
        },
    }
