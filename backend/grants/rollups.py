"""Read-time financial rollups for grants (single source of truth).

Money is aggregated only here, at read time, from the scoped Grant queryset —
mirroring ``analysis.services.coordinator_rollups`` so the API, the summary
endpoint and any export all agree.
"""
from decimal import Decimal

from django.db.models import Sum

from .models import GrantDisbursement, GrantExpenditure

ZERO = Decimal("0.00")


def _pct(part, whole):
    return float(part / whole * 100) if whole else None


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
