import re


CANONICAL_INDICATOR_MAP = [
    {
        "key": "hiv_tested",
        "label": "Tested for HIV",
        "stage": "tested",
        "aliases": [
            "Number of people tested for HIV.",
            "Number of Number of people tested for HIV.",
            "HIVPM_HIV_TESTED",
            "Number of people tested for HIV",
        ],
    },
    {
        "key": "hiv_positive",
        "label": "Tested HIV Positive",
        "stage": "positive",
        "aliases": [
            "Number of people who tested positive for HIV.",
            "Number of people who tested positive for HIV",
            "Number of people who tested positiv...",
        ],
    },
    {
        "key": "hiv_screened",
        "label": "Screened for HIV",
        "stage": "screened",
        "aliases": ["HIVPM_HIV_SCREENED", "Screened for HIV"],
    },
    {
        "key": "referred_hiv_testing",
        "label": "Referred for HIV Testing",
        "stage": "referred",
        "aliases": [
            "Number of people referred for HIV testing.",
            "Number of people referred for HIV Testing.",
            "AUTO_NUMBER_OF_PEOPLE_REFERRED_FOR_HIV_",
        ],
    },
    {
        "key": "referred_pep",
        "label": "Referred for PEP",
        "stage": "referred",
        "aliases": ["Number of people referred for PEP."],
    },
    {
        "key": "referred_prep",
        "label": "Referred for PrEP",
        "stage": "referred",
        "aliases": ["Number of people referred for PrEP."],
    },
    {
        "key": "linked_to_care",
        "label": "Linked to Care",
        "stage": "linked",
        "aliases": ["Linked to care", "Number of people linked to care.", "HIVPM_LINKED_TO_CARE"],
    },
    {
        "key": "linked_justice_services",
        "label": "Linked to Justice Services",
        "stage": "linked",
        "aliases": [
            "Number of people linked to justice services",
            "Number of people linked to justice services.",
            "Number of Number of people linked to justice services",
        ],
    },
    {
        "key": "provided_legal_aid",
        "label": "Provided with Legal Aid Services",
        "stage": "service",
        "aliases": [
            "Number of people provided with legal aid services",
            "Number of people provided with legal aid services.",
            "Number of Number of people provided with legal aid services",
            "Number of PLWHs provided with legal services",
        ],
    },
    {
        "key": "sti_referrals_completed",
        "label": "STI Referrals Completed",
        "stage": "service",
        "aliases": ["Number of STI cases referrals completed", "Number of STIs referrals completed"],
    },
    {
        "key": "plwh_tb_treatment",
        "label": "Number of PLWH who tested positive for TB and are on treatment",
        "stage": "service",
        "aliases": [
            "Number of PLWH who tested positive for TB and are on treatment.",
            "Number of people living with HIV who tested positive for TB and are on treatment",
            "Number of people living with HIV who tested positive for TB and are on treatment.",
        ],
    },
    {
        "key": "rights_redress_sought",
        "label": "Sought Redress for Rights Violations",
        "stage": "service",
        "aliases": [
            "Number of people who report that their rights were violated and who sought redness",
            "Number of people who sought redress.",
        ],
    },
]

PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY = {
    "number of people referred for hiv testing": (331, 445),
    "number of people referred for pep": (339, 446),
    "number of people provided with legal aid services": (458, 340, 473),
    "number of people linked to justice services": (460, 341, 474),
    "number of people screened positive for stis referred for services": (352, 468),
    "number of sti cases linked to care": (353, 469),
    "number of sti cases referrals completed": (354, 470, 511),
    "number of people who tested positive for hiv": (333, 452),
    "number of plwh who tested positive for tb and are on treatment": (525, 482),
}


def normalize_indicator_text(value: str) -> str:
    normalized = str(value or "").lower()
    normalized = re.sub(r"[._,;:!?()[\]{}\"/\\-]+", " ", normalized)
    normalized = normalized.replace("elligible", "eligible")
    normalized = normalized.replace("reffered", "referred")
    normalized = normalized.replace("pyschosocial", "psychosocial")
    normalized = normalized.replace("descrimination", "discrimination")
    normalized = normalized.replace("coodinators", "coordinators")
    normalized = normalized.replace("perforamance", "performance")
    normalized = normalized.replace("identifies needs", "identified needs")
    normalized = normalized.replace("field visists", "field visits")
    normalized = normalized.replace("virsual presentations", "visual presentations")
    normalized = normalized.replace("redness", "redress")
    normalized = normalized.replace("people living with hiv", "plwh")
    normalized = normalized.replace("persons living with hiv", "plwh")
    normalized = normalized.replace("number of number of people", "number of people")
    normalized = normalized.replace("number of number of", "number of")
    normalized = normalized.replace("total number of", "number of")
    normalized = normalized.replace("number number", "number")
    normalized = normalized.replace("peoples", "people")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


normalizeIndicatorText = normalize_indicator_text


_CANONICAL_LOOKUP = {}
for canonical_indicator in CANONICAL_INDICATOR_MAP:
    variants = [
        canonical_indicator["key"],
        canonical_indicator["label"],
        *canonical_indicator["aliases"],
    ]
    for variant in variants:
        _CANONICAL_LOOKUP[normalize_indicator_text(variant)] = canonical_indicator


def resolve_canonical_indicator(input_value: str):
    return _CANONICAL_LOOKUP.get(normalize_indicator_text(input_value))


resolveCanonicalIndicator = resolve_canonical_indicator


def canonical_resolution_aliases(input_value: str) -> list[str]:
    canonical_indicator = resolve_canonical_indicator(input_value)
    if not canonical_indicator:
        return []
    values = [canonical_indicator["label"], *canonical_indicator["aliases"]]
    seen = set()
    ordered = []
    for value in values:
        normalized = normalize_indicator_text(value)
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(value)
    return ordered


def preferred_duplicate_rank(indicator_id: int, indicator_key: str) -> int:
    preferred_ids = PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY.get(str(indicator_key or "").strip())
    if not preferred_ids:
        return 0
    if indicator_id == preferred_ids[0]:
        return 0
    if indicator_id in preferred_ids[1:]:
        return 1
    return 2
