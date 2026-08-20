"""Push questionnaire schema v22 live (idempotent; see 0006-0015).

v22 folds in the admin's in-app form-editor edits so a backend deploy does not
clobber them, and ships alongside the load_schema() fix that resolves each
field's inline choices from its shared list. Changes vs v21:
  * districts: +Sowa, +Tonota; label tweaks (Kgalagadi North/South, Ngami->North-West);
  * respondent_type: "DAC, DHMT, ..." -> "DAC, PHC, ...";
  * new admin question "Where is the organisation registered?" (q_r2tf7pkx);
  * new conditional "Which non-communicable diseases..." after the services question;
  * required flags on physical_address / respondent_email / respondent_phone /
    years_in_operation / annex3_funding_sources;
  * consent given its own choice list (consent_yesno) so it keeps its custom labels.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.db import migrations

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "form_schema.json"


def _bundled():
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def activate(apps, schema_editor):
    Version = apps.get_model("cso_mapping", "CsoMappingSchemaVersion")
    bundled = _bundled()
    label = str(bundled.get("version", ""))[:64]
    active = Version.objects.filter(is_active=True).first()
    if active is not None and active.version_label == label:
        return
    Version.objects.filter(is_active=True).update(is_active=False)
    Version.objects.create(
        schema=bundled,
        version_label=label,
        note="Folded in form-editor edits (districts, respondent_type PHC, "
             "registration-place and NCD questions, required flags, consent list).",
        is_active=True,
    )


def deactivate(apps, schema_editor):
    Version = apps.get_model("cso_mapping", "CsoMappingSchemaVersion")
    bundled = _bundled()
    label = str(bundled.get("version", ""))[:64]
    created = Version.objects.filter(version_label=label, is_active=True).order_by("-id").first()
    if created is None:
        return
    created.is_active = False
    created.save(update_fields=["is_active"])
    previous = Version.objects.exclude(pk=created.pk).order_by("-id").first()
    if previous is not None:
        previous.is_active = True
        previous.save(update_fields=["is_active"])


class Migration(migrations.Migration):

    dependencies = [
        ("cso_mapping", "0015_activate_schema_v21"),
    ]

    operations = [
        migrations.RunPython(activate, deactivate),
    ]
