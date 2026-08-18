"""Canonical CSO-mapping form schema + relevance helpers.

``form_schema.json`` is generated from the KoboToolbox XLSForm
(``xlsform_to_schema.mjs``) and is the single source of truth shared by:

  * this backend — served publicly (GET /api/cso-mapping/schema/), used to
    validate submissions and to build export headers; and
  * the Next.js frontend — fetched and rendered as the native questionnaire.

Keeping one schema means the form only has to be re-generated (not re-coded in
two places) when the XLSForm changes.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "form_schema.json"

# Display-only field types that never carry an answer.
NOTE_TYPES = {"note"}

# Core administrative fields promoted to their own model columns. Everything
# else (the annex domain answers) is stored in the ``answers`` JSON blob.
CORE_TEXT_FIELDS = {
    "respondent_type",
    "responding_entity",
    "respondent_name",
    "respondent_position",
    "respondent_phone",
    "respondent_email",
    "primary_district",
    "additional_comments",
}
CORE_BOOL_FIELDS = {"consent", "information_confirmed"}
CORE_FIELDS = CORE_TEXT_FIELDS | CORE_BOOL_FIELDS

# Hard ceiling on any single free-text answer (defence against oversized
# payloads on the public endpoint).
MAX_ANSWER_LENGTH = 20000

# Hard ceiling on a serialized draft answers blob (defence on the draft endpoint).
MAX_DRAFT_BYTES = 200_000

# Each SELECTED option of a multiple-choice question may carry an OPTIONAL
# free-text comment, stored in the answers blob under
# "<field_name>__comment__<option_name>". This is a convention (not a schema
# field), so it applies to every current and future select question / option
# without editing the form.
COMMENT_SEP = "__comment__"


def comment_key(field_name: str, option: str) -> str:
    return f"{field_name}{COMMENT_SEP}{option}"


def comment_prefix(field_name: str) -> str:
    return f"{field_name}{COMMENT_SEP}"


@lru_cache(maxsize=1)
def _bundled_schema() -> dict:
    """The schema shipped in the image: seed for a fresh DB and last-resort fallback."""
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_schema() -> dict:
    """Return the questionnaire schema currently served to respondents.

    Source of truth is the active :class:`CsoMappingSchemaVersion` row, so admins
    can edit the form without a code deploy. If no active row exists yet (fresh
    database) or the DB is unreachable during a management command, fall back to
    the bundled file so the form is never blank. Read per call (small payload) so
    an edit applies immediately across all gunicorn workers.
    """
    try:
        from .models import CsoMappingSchemaVersion

        active = (
            CsoMappingSchemaVersion.objects.filter(is_active=True)
            .values_list("schema", flat=True)
            .first()
        )
        if active:
            return active
    except Exception:  # DB not ready (migrate/checks) — use the bundled file.
        pass
    return _bundled_schema()


# A composite, repeatable field ("Funding sources" style): its answer is a LIST
# of small objects, one per record. The sub-fields are fixed and known to both
# the backend (validation/storage/export) and the frontend renderer.
FUNDING_SOURCES_TYPE = "funding_sources"
FUNDING_ITEM_KEYS = ("funder_name", "project_name", "scope", "period")
FUNDING_ITEM_REQUIRED_KEYS = ("funder_name",)
MAX_FUNDING_ITEMS = 20

# Field types the editor + renderer understand, and the relevance operators the
# evaluator supports. Kept in sync with field_is_active / the frontend renderer.
EDITABLE_FIELD_TYPES = {"text", "select_one", "select_multiple", "note", FUNDING_SOURCES_TYPE}
# Field types whose answer is a LIST of choice names (not a scalar string).
MULTI_SELECT_TYPES = {"select_multiple"}
# eq/ne compare a scalar; "selected" tests membership of a value in a
# multi-select answer (used by "Other — specify" follow-ups).
RELEVANCE_OPS = {"eq", "ne", "selected"}
_FIELD_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")


class SchemaValidationError(Exception):
    """Raised when a proposed schema would be unusable/unsafe. Carries a list of
    human-readable problems for the admin editor to display."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def _check_condition(cond, field_names, where, errors):
    if not cond:
        return
    if not isinstance(cond, dict):
        errors.append(f"{where}: the show-if rule must be an object.")
        return
    if "raw" in cond:  # opaque expression we don't evaluate — leave as-is
        return
    ref = cond.get("field")
    if ref != "." and ref not in field_names:
        errors.append(f"{where}: show-if references an unknown question '{ref}'.")
    if cond.get("op", "eq") not in RELEVANCE_OPS:
        errors.append(f"{where}: show-if operator must be 'eq' or 'ne'.")
    if "value" not in cond:
        errors.append(f"{where}: show-if needs a value.")


def validate_schema(data) -> None:
    """Raise :class:`SchemaValidationError` if ``data`` is not a usable schema.

    Guards the LIVE form against a bad admin edit: enforces structure, unique and
    well-formed question names, known field types, valid choice-list references,
    sane show-if rules, and the continued presence of the system fields the
    submission pipeline depends on (consent, respondent_type, …).
    """
    errors: list[str] = []
    if not isinstance(data, dict):
        raise SchemaValidationError(["The schema must be a JSON object."])

    for key in ("id_string", "version", "title", "sections", "choices"):
        if key not in data:
            errors.append(f"Missing required top-level key: '{key}'.")

    sections = data.get("sections")
    choices = data.get("choices", {})
    if not isinstance(sections, list) or not sections:
        errors.append("'sections' must be a non-empty list.")
        sections = []
    if not isinstance(choices, dict):
        errors.append("'choices' must be an object of named choice lists.")
        choices = {}

    # First pass: collect every field name so show-if references can be checked.
    all_names: set[str] = set()
    for sec in sections:
        if isinstance(sec, dict):
            for f in sec.get("fields") or []:
                if isinstance(f, dict) and f.get("name"):
                    all_names.add(f["name"])

    seen: set[str] = set()
    for si, sec in enumerate(sections):
        if not isinstance(sec, dict):
            errors.append(f"Section #{si + 1} must be an object.")
            continue
        sname = sec.get("name") or f"#{si + 1}"
        fields = sec.get("fields")
        if not isinstance(fields, list):
            errors.append(f"Section '{sname}' must have a list of fields.")
            continue
        _check_condition(sec.get("relevant"), all_names, f"Section '{sname}'", errors)
        for f in fields:
            if not isinstance(f, dict):
                errors.append(f"A field in section '{sname}' is not an object.")
                continue
            name = f.get("name")
            ftype = f.get("type")
            if not name or not isinstance(name, str) or not _FIELD_NAME_RE.match(name):
                errors.append(
                    f"Question name '{name}' is invalid — use letters, numbers and "
                    "underscores, starting with a letter."
                )
            elif name in seen:
                errors.append(f"Duplicate question name '{name}' (names must be unique).")
            else:
                seen.add(name)
            if ftype not in EDITABLE_FIELD_TYPES:
                errors.append(
                    f"Question '{name}': type '{ftype}' is not allowed "
                    "(text, select_one or note)."
                )
            if ftype != "note" and not f.get("label"):
                errors.append(f"Question '{name}': a label is required.")
            if ftype in ("select_one", "select_multiple"):
                lst = f.get("list")
                if not lst or lst not in choices:
                    errors.append(
                        f"Question '{name}': a multiple-choice question needs a valid "
                        "choice list."
                    )
            if ftype == FUNDING_SOURCES_TYPE:
                subs = f.get("sub_fields")
                if not isinstance(subs, list) or not subs:
                    errors.append(
                        f"Question '{name}': a funding-sources question needs sub-fields."
                    )
                else:
                    for sf in subs:
                        sub_name = sf.get("name") if isinstance(sf, dict) else None
                        if not sub_name or not _FIELD_NAME_RE.match(sub_name):
                            errors.append(
                                f"Question '{name}': each funding sub-field needs a valid name."
                            )
                        elif sf.get("type") not in ("text", "select_one"):
                            errors.append(
                                f"Question '{name}': funding sub-field '{sub_name}' has an "
                                "unsupported type."
                            )
            _check_condition(f.get("relevant"), all_names, f"Question '{name}'", errors)

    missing = CORE_FIELDS - all_names
    if missing:
        errors.append(
            "These system questions must remain in the form (removing them breaks "
            "submission storage): " + ", ".join(sorted(missing)) + "."
        )

    if errors:
        raise SchemaValidationError(errors)


def cond_satisfied(cond: dict | None, data: dict) -> bool:
    """Evaluate a parsed relevance/constraint condition against answers.

    Conditions are ``{"field": <name|".">, "op": "eq", "value": <str>}`` or
    ``None`` (always true). ``"."`` refers to the field the constraint is on and
    must be resolved by the caller before calling this helper.
    """
    if not cond:
        return True
    if "raw" in cond:  # unexpected expression we couldn't parse — treat as shown
        return True
    raw = data.get(cond["field"], "")
    op = cond.get("op")
    # "selected": is the value one of the chosen options of a multi-select answer?
    if op == "selected":
        chosen = raw if isinstance(raw, list) else [raw]
        return cond["value"] in [str(v) for v in chosen]
    # eq/ne compare against a scalar; a list answer is joined so a bare eq never
    # matches a multi-select (callers use "selected" for those).
    actual = ", ".join(str(v) for v in raw) if isinstance(raw, list) else str(raw)
    if op == "ne":
        return actual != cond["value"]
    return actual == cond["value"]


def field_is_active(section: dict, field: dict, data: dict) -> bool:
    """A field is active only when both its section and its own relevance hold."""
    return cond_satisfied(section.get("relevant"), data) and cond_satisfied(
        field.get("relevant"), data
    )


def iter_answerable_fields(schema: dict):
    """Yield (section, field) for every non-note field in the schema."""
    for section in schema["sections"]:
        for field in section["fields"]:
            if field["type"] in NOTE_TYPES:
                continue
            yield section, field


def choice_names(schema: dict, list_name: str) -> set[str]:
    return {c["name"] for c in schema.get("choices", {}).get(list_name, [])}


def choice_label(schema: dict, list_name: str, name: str) -> str:
    """Human-readable label for a stored choice name (falls back to the name)."""
    for choice in schema.get("choices", {}).get(list_name, []):
        if choice.get("name") == name:
            return choice.get("label", name)
    return name


def display_answer(schema: dict, field: dict, value) -> str:
    """Render a stored answer for export/display: multi-select joined, choices labelled."""
    ftype = field.get("type")
    if ftype == FUNDING_SOURCES_TYPE:
        items = value if isinstance(value, list) else []
        labels = {
            sf["name"]: sf.get("label", sf["name"])
            for sf in (field.get("sub_fields") or [])
            if isinstance(sf, dict) and sf.get("name")
        }
        keys = list(labels) or list(FUNDING_ITEM_KEYS)
        lines = []
        for i, item in enumerate(items, 1):
            if not isinstance(item, dict):
                continue
            parts = [
                f"{labels.get(k, k)}: {str(item.get(k, '') or '').strip()}"
                for k in keys
                if str(item.get(k, "") or "").strip()
            ]
            if parts:
                lines.append(f"{i}. " + "; ".join(parts))
        return "\n".join(lines)
    if ftype == "select_multiple":
        items = value if isinstance(value, list) else ([] if value in (None, "") else [value])
        return ", ".join(choice_label(schema, field.get("list", ""), v) for v in items)
    if ftype == "select_one" and value:
        return choice_label(schema, field.get("list", ""), value)
    return "" if value is None else str(value)


def strip_inactive_branch_answers(schema: dict, answers: dict) -> dict:
    """Drop answers for questions not active under the draft's current answers.

    Used when persisting a draft so a respondent who switches respondent type does
    not retain the previous branch's Annex answers. Consent is assumed for the
    branch evaluation (a draft with Annex answers has passed the consent gate);
    ``consent``/``respondent_type`` are always preserved so progress is not lost.
    """
    if not isinstance(answers, dict):
        return {}
    ctx = dict(answers)
    ctx.setdefault("consent", "yes")
    active = {
        field["name"]
        for section, field in iter_answerable_fields(schema)
        if field_is_active(section, field, ctx)
    }
    # The captured office-location keys are not schema fields but must survive a
    # draft round-trip (so coordinates persist across sections / device resume).
    from .location import LOCATION_KEYS

    keep = active | {"consent", "respondent_type"} | set(LOCATION_KEYS)

    # Optional per-option comments ride alongside their (active) question.
    def _is_active_comment(key: str) -> bool:
        return COMMENT_SEP in key and key.split(COMMENT_SEP, 1)[0] in active

    return {k: v for k, v in answers.items() if k in keep or _is_active_comment(k)}
