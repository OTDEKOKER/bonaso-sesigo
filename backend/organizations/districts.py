"""Canonical Botswana health-district list for SESIGO.

Single source of truth for the districts an organisation/site can be assigned to
and for the executive District filter. The list is the exact set the CSO Mapping
questionnaire offers in its ``primary_district`` (select_one) and
``implementing_districts`` (select_multiple, "Other implementing sites
(districts)") fields — see ``backend/cso_mapping/form_schema.json`` choices.

Adopted per user direction 2026-08-17 ("take the district list only"): use this
29-entry health-district grain (NOT the coarser ~10 administrative districts that
``ProjectOrganization.districts`` was historically populated with).

Kept as a plain constant so it can validate ``Organization.district`` choices,
seed sites, and drive the dashboard filter without re-hardcoding the list in
several places.
"""

# Order mirrors the questionnaire choice order.
BOTSWANA_DISTRICTS: tuple[str, ...] = (
    "Bobirwa",
    "Boteti",
    "Charleshill",
    "Chobe",
    "Ghanzi",
    "Goodhope",
    "Greater Francistown",
    "Greater Gaborone",
    "Jwaneng",
    "Kanye",
    "Kgalagadi North",
    "Kgalagadi South",
    "Kgatleng",
    "Letlhakeng",
    "Lobatse",
    "Mabutsane",
    "Mahalapye",
    "Mogoditshane-Thamaga",
    "Molepolole",
    "Moshupa",
    "Ngami",
    "North East",
    "Okavango",
    "Palapye",
    "Phikwe",
    "Ramotswa",
    "Serowe",
    "Tlokweng",
    "Tutume",
)

# Django-style choices for a model/serializer field.
DISTRICT_CHOICES = tuple((d, d) for d in BOTSWANA_DISTRICTS)

# Case-insensitive membership check helper.
_DISTRICT_LOOKUP = {d.lower(): d for d in BOTSWANA_DISTRICTS}


def is_valid_district(name: str) -> bool:
    return str(name or "").strip().lower() in _DISTRICT_LOOKUP


def canonical_district(name: str) -> str | None:
    """Return the canonical spelling for ``name`` if it is one of the 29, else None."""
    return _DISTRICT_LOOKUP.get(str(name or "").strip().lower())
