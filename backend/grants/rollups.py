"""Read-time financial rollups for grants (single source of truth).

Money is aggregated only here, at read time, from the scoped Grant queryset —
mirroring ``analysis.services.coordinator_rollups`` so the API, the summary
endpoint and any export all agree.
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from .models import GrantDisbursement, GrantExpenditure

ZERO = Decimal("0.00")
QUARTERS = ["Q1", "Q2", "Q3", "Q4"]


def _pct(part, whole):
    return float(part / whole * 100) if whole else None


def fy_quarter_for_date(d) -> tuple[int, str]:
    """Botswana fiscal year (Apr–Mar): Q1 Apr–Jun … Q4 Jan–Mar of the NEXT
    calendar year (which belongs to the previous fiscal year). Mirrors
    analysis.views._fiscal_year_quarter_for_month so grants match the rest of
    Sesigo's quarterly reporting."""
    m, y = d.month, d.year
    if 4 <= m <= 6:
        return (y, "Q1")
    if 7 <= m <= 9:
        return (y, "Q2")
    if 10 <= m <= 12:
        return (y, "Q3")
    return (y - 1, "Q4")


def _current_fiscal_year() -> int:
    today = date.today()
    return today.year if today.month >= 4 else today.year - 1


def grant_financials(grant) -> dict:
    """Budget / disbursed / spent / remaining / burn for ONE grant."""
    budgeted = grant.budget_lines.aggregate(s=Sum("budgeted_amount"))["s"] or ZERO
    disbursed = grant.disbursements.aggregate(s=Sum("amount"))["s"] or ZERO
    spent = grant.expenditures.aggregate(s=Sum("amount"))["s"] or ZERO
    awarded = grant.total_amount or ZERO
    return {
        "awarded": awarded,
        "budgeted": budgeted,
        "disbursed": disbursed,
        "spent": spent,
        "remaining": awarded - spent,
        "cash_on_hand": disbursed - spent,
        "burn_pct": _pct(spent, awarded),
    }


def summarize_by_organization(grants) -> dict:
    """Per-org awarded/disbursed/spent/remaining/burn from a SCOPED Grant qs.

    ``grants`` must already be narrowed to what the caller may see (the viewset
    passes its scoped ``get_queryset()``), so this never widens visibility.
    Returns rows sorted worst-first (highest burn) with a grand-total footer.
    """
    awarded, names = {}, {}
    for r in grants.values("organization_id", "organization__name").annotate(v=Sum("total_amount")):
        awarded[r["organization_id"]] = r["v"] or ZERO
        names[r["organization_id"]] = r["organization__name"]

    disbursed = {
        r["grant__organization_id"]: (r["v"] or ZERO)
        for r in GrantDisbursement.objects.filter(grant__in=grants)
        .values("grant__organization_id").annotate(v=Sum("amount"))
    }
    spent = {
        r["grant__organization_id"]: (r["v"] or ZERO)
        for r in GrantExpenditure.objects.filter(grant__in=grants)
        .values("grant__organization_id").annotate(v=Sum("amount"))
    }

    rows = []
    t_aw = t_di = t_sp = ZERO
    for org_id in awarded:
        aw = awarded.get(org_id, ZERO)
        di = disbursed.get(org_id, ZERO)
        sp = spent.get(org_id, ZERO)
        rows.append({
            "organization_id": org_id,
            "organization_name": names.get(org_id),
            "awarded": aw,
            "disbursed": di,
            "spent": sp,
            "remaining": aw - sp,
            "burn_pct": _pct(sp, aw),
        })
        t_aw += aw
        t_di += di
        t_sp += sp

    # Worst-first: highest burn on top; orgs with no award (burn None) sink last.
    rows.sort(key=lambda r: (r["burn_pct"] is None, -(r["burn_pct"] or 0.0)))

    return {
        "organizations": rows,
        "grand_total": {
            "awarded": t_aw,
            "disbursed": t_di,
            "spent": t_sp,
            "remaining": t_aw - t_sp,
            "burn_pct": _pct(t_sp, t_aw),
            "organization_count": len(rows),
        },
    }


def quarterly_expenditure(grants, *, project=None, fiscal_year=None) -> dict:
    """Per-organization expenditure by FY quarter, grouped/rolled up by coordinator.

    ``grants`` must be the SCOPED queryset (caller passes the viewset's
    filter_queryset(get_queryset())), so this never widens visibility. When a
    ``project`` is given, orgs are grouped under their coordinator using THAT
    project's hierarchy (ProjectOrganizationHierarchy) and the coordinator row is
    the subtree rollup (coordinator's own grant + all its sub-grantees).
    """
    awarded, names = {}, {}
    for r in grants.values("organization_id", "organization__name").annotate(v=Sum("total_amount")):
        awarded[r["organization_id"]] = r["v"] or ZERO
        names[r["organization_id"]] = r["organization__name"]

    # Expenditure per (org, fiscal_year, quarter).
    per_org_fyq: dict = defaultdict(lambda: defaultdict(lambda: ZERO))
    fys_present: set[int] = set()
    for org_id, d, amount in GrantExpenditure.objects.filter(grant__in=grants).values_list(
        "grant__organization_id", "date", "amount"
    ):
        fy, q = fy_quarter_for_date(d)
        per_org_fyq[org_id][(fy, q)] += (amount or ZERO)
        fys_present.add(fy)

    available_fys = sorted(fys_present)
    if fiscal_year is None:
        fiscal_year = available_fys[-1] if available_fys else _current_fiscal_year()
    fiscal_year = int(fiscal_year)

    def org_row(org_id):
        qmap = {q: per_org_fyq[org_id].get((fiscal_year, q), ZERO) for q in QUARTERS}
        fy_total = sum(qmap.values(), ZERO)
        aw = awarded.get(org_id, ZERO)
        return {
            "organization_id": org_id,
            "organization_name": names.get(org_id),
            "awarded": aw,
            "quarters": qmap,
            "fy_total": fy_total,
            "burn_pct": _pct(fy_total, aw),
        }

    def rollup(rows):
        q = {qk: sum((r["quarters"][qk] for r in rows), ZERO) for qk in QUARTERS}
        aw = sum((r["awarded"] for r in rows), ZERO)
        total = sum(q.values(), ZERO)
        return q, aw, total

    org_ids = set(awarded.keys())
    coordinators = []
    grouped: set[int] = set()

    if project is not None:
        from organizations.models import Organization
        from projects.models import ProjectOrganization
        from projects.scope import get_project_subtree_org_ids

        coord_ids = list(
            ProjectOrganization.objects.filter(
                project=project, is_coordinator=True, is_active=True
            ).values_list("organization_id", flat=True)
        )
        coord_names = dict(Organization.objects.filter(id__in=coord_ids).values_list("id", "name"))
        for coord_id in coord_ids:
            subtree = get_project_subtree_org_ids(project, coord_id)
            members = [org_row(o) for o in subtree if o in org_ids]
            if not members:
                continue
            grouped |= {m["organization_id"] for m in members}
            q, aw, total = rollup(members)
            members.sort(key=lambda m: (m["organization_id"] != coord_id, m["organization_name"] or ""))
            coordinators.append({
                "organization_id": coord_id,
                "organization_name": coord_names.get(coord_id) or names.get(coord_id),
                "awarded": aw,
                "quarters": q,
                "fy_total": total,
                "burn_pct": _pct(total, aw),
                "members": members,
            })
        coordinators.sort(key=lambda c: c["organization_name"] or "")

    ungrouped = sorted(
        (org_row(o) for o in org_ids if o not in grouped),
        key=lambda r: r["organization_name"] or "",
    )

    all_rows = [org_row(o) for o in org_ids]
    g_q, g_aw, g_total = rollup(all_rows)

    return {
        "fiscal_year": fiscal_year,
        "available_fiscal_years": available_fys or [fiscal_year],
        "quarters": QUARTERS,
        "coordinators": coordinators,
        "ungrouped": ungrouped,
        "grand_total": {
            "awarded": g_aw,
            "quarters": g_q,
            "fy_total": g_total,
            "burn_pct": _pct(g_total, g_aw),
        },
    }
