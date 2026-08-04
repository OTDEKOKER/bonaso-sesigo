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


@lru_cache(maxsize=1)
def load_schema() -> dict:
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


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
    return str(data.get(cond["field"], "")) == cond["value"]


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
    keep = active | {"consent", "respondent_type"}
    return {k: v for k, v in answers.items() if k in keep}
