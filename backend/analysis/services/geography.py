"""Geographic coverage for the management-intelligence 'Where' layer.

Read-only. Aggregates organisation coverage (``ProjectOrganization.districts``)
onto normalised Botswana admin regions.

Honesty rules (constraints 14/15):
  * Coverage is ORG-LEVEL, not per-record. **Presence counts are exact**; we do
    NOT sum approved values across a multi-district org (that would double-count),
    so this layer answers "where are we present", not "how much per district".
  * Only Project 3 currently has coverage data; Project 2 has none, so its
    geographic layer is empty by design (its report is by-CSO).
  * The label normalisation below is a DISPLAY mapping (reversible here), not a
    data change. Spelling/typo fixes are unambiguous; the two folds are documented
    judgement calls (see comments) and easy to change.
"""
from collections import defaultdict

from projects.models import ProjectOrganization

# raw label (lower-cased, trimmed) -> standard Botswana region label.
BOTSWANA_DISTRICT_NORMALIZATION = {
    # unambiguous spelling / hyphen fixes
    "north west": "North West",
    "north-west": "North West",
    "north east": "North East",
    "north-east": "North East",
    "south east": "South East",
    "south-east": "South East",
    "gantsi": "Ghanzi",
    "ghanzi": "Ghanzi",
    # documented folds (judgement calls, reversible):
    #   Francistown (a city) -> the surrounding North East region
    "francistown": "North East",
    #   Greater Gaborone -> the Gaborone node
    "greater gaborone": "Gaborone",
    "gaborone": "Gaborone",
    # pass-through canonical labels
    "central": "Central",
    "kweneng": "Kweneng",
    "southern": "Southern",
    "kgatleng": "Kgatleng",
    "chobe": "Chobe",
    "kgalagadi": "Kgalagadi",
}


def normalize_district(raw) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    return BOTSWANA_DISTRICT_NORMALIZATION.get(text.lower(), text)


def build_geographic_coverage(project_id: int) -> dict:
    """Exact org/coordinator presence per normalised district for a project."""
    pos = ProjectOrganization.objects.filter(project_id=project_id).select_related("organization")
    # Rep 3b: canonical coordinator read-through. ``pos`` is not is_active-filtered,
    # so active_only=False makes ``org_id in coord_ids`` equal the legacy
    # per-row ``po.is_coordinator`` exactly under HIERARCHY_SOURCE='global'.
    from projects.derived_roles import coordinator_org_ids
    coord_ids = coordinator_org_ids(project_id, active_only=False)
    per = defaultdict(lambda: {"orgs": set(), "coordinators": set()})
    raw_labels: set[str] = set()
    orgs_with_coverage = 0

    for po in pos:
        districts = po.districts or []
        if districts:
            orgs_with_coverage += 1
        for raw in districts:
            raw_labels.add(str(raw).strip())
            d = normalize_district(raw)
            if not d:
                continue
            per[d]["orgs"].add(po.organization_id)
            if po.organization_id in coord_ids:
                per[d]["coordinators"].add(po.organization_id)

    districts = sorted(
        (
            {
                "district": d,
                "orgs_present": len(v["orgs"]),
                "coordinators_present": len(v["coordinators"]),
            }
            for d, v in per.items()
        ),
        key=lambda r: (r["orgs_present"], r["district"]),
        reverse=True,
    )

    return {
        "project_id": project_id,
        "orgs_with_coverage": orgs_with_coverage,
        "raw_label_count": len(raw_labels),
        "normalized_district_count": len(districts),
        "attribution": "coverage-based; presence counts are exact, values are NOT summed per district",
        "districts": districts,
    }
