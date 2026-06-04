"""
Seed the BONELA Individual Outreach Form (Key Populations) as an Assessment.

This digitises the paper "Individual Outreach Form - KP" (BONELA / NAHPA) into
the question-bank model: each form item becomes a reusable ``Question`` and is
placed on the ``Assessment`` via ``AssessmentQuestion``. No indicators are
created — questions are separate from indicators and only link to one when you
explicitly want roll-up.

The command is idempotent: it matches questions by ``code`` and the assessment
by ``name``, so re-running updates question text/options/order in place rather
than duplicating. Use ``--dry-run`` to preview without writing.

    python manage.py seed_bonela_outreach_form [--dry-run]
        [--org-codes BONELA,BONEPWA]    # scope the assessment to these orgs
        [--indicator-org-codes BONELA]  # default org link for every question

Organization scoping
--------------------
The org link lives on each ``Question`` (``Question.organizations``). In this
system a question/assessment with **no** linked organization is *cross-cutting*
— visible to every organization; linking specific orgs limits it to those orgs
(plus admins). So:

* By default the form is left fully **cross-cutting** (no org links), so it is
  not restricted to BONELA and every organization can use it.
* ``--org-codes`` links the assessment to a specific set of organizations.
* ``--indicator-org-codes`` sets the default org link applied to every question.
* A question may carry an ``"orgs"`` list to link *itself* to specific
  organizations (overriding the CLI default), while other questions stay
  cross-cutting. This lets one shared form mix cross-cutting and
  organization-specific questions.

Roll-up is intentionally off (``aggregate_mode='none'``, no linked indicator)
for every question, so seeding the form does not alter any project/indicator
totals. Linking specific questions (commodities, referrals, screenings) to
programme indicators can be done later as a deliberate, reviewed step.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from indicators.models import Assessment, AssessmentQuestion, Question
from organizations.models import Organization

ASSESSMENT_NAME = "BONELA Individual Outreach Form (Key Populations)"
ASSESSMENT_DESCRIPTION = (
    "Digitised individual outreach / KP screening form (BONELA, NAHPA). "
    "Captures session context, demographics, prevention-message reach, HIV "
    "risk and GBV screening, substance use, stigma, topics discussed, "
    "referrals, linkage to care and commodities distributed."
)

# Each entry:
#   code          unique Question.code (<= 50 chars)
#   question      prompt shown to the data collector (Question.text)
#   type          one of Indicator.TYPE_CHOICES (Question.response_type)
#   category      one of Indicator.CATEGORY_CHOICES
#   options       list of labels for select/multiselect (optional)
#   required      AssessmentQuestion.is_required (default True)
#   help          Question.help_text (optional)
#   depends_on    code of a prior question this one follows from (optional)
QUESTIONS = [
    # --- Section A: Session information -----------------------------------
    {
        "code": "BONELA_KP_IMPL_PARTNER",
        "question": "Implementing Partner Name",
        "type": "text",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_DISTRICT",
        "question": "District",
        "type": "text",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_VILLAGE",
        "question": "Village",
        "type": "text",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_SESSION_LOCATION",
        "question": "Session Location",
        "type": "text",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_SESSION_DATE",
        "question": "Date of session",
        "type": "date",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_MOBILISER",
        "question": "Community Mobiliser Name",
        "type": "text",
        "category": "hiv_prevention",
    },
    # --- Section B: Demographics ------------------------------------------
    {
        "code": "BONELA_KP_SEX",
        "question": "Sex",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Male", "Female", "Intersex"],
    },
    {
        "code": "BONELA_KP_AGE",
        "question": "Age",
        "type": "number",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_POPULATION_TYPE",
        "question": "Key Population Type",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": ["MSM", "FSW", "LGBTIQ", "PWIDs", "PWUDs"],
        "help": "Tick all that apply.",
    },
    {
        "code": "BONELA_KP_RELATIONSHIP_STATUS",
        "question": "Relationship status",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Married", "Single", "Cohabiting", "Widowed", "Divorced"],
    },
    {
        "code": "BONELA_KP_CITIZENSHIP",
        "question": "Citizenship",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Citizen", "Non-Citizen"],
    },
    {
        "code": "BONELA_KP_PREGNANCY_STATUS",
        "question": "Pregnancy status",
        "type": "yes_no",
        "category": "hiv_prevention",
        "required": False,
        "help": "Where applicable.",
    },
    # --- Section C: Prevention-message reach ------------------------------
    {
        "code": "BONELA_KP_REACHED_PREV_MSG",
        "question": "Have you been reached with prevention messages by anyone from other organizations?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_REACHED_ORG_NAME",
        "question": "If yes, organization name",
        "type": "text",
        "category": "hiv_prevention",
        "required": False,
        "depends_on": "BONELA_KP_REACHED_PREV_MSG",
        "help": "Only if reached by another organization. Tick / note if not sure where they were from.",
    },
    {
        "code": "BONELA_KP_REACHED_HOW_LONG_AGO",
        "question": "If yes, how long ago was this?",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["In the last 3 months", "Over a year"],
        "required": False,
        "depends_on": "BONELA_KP_REACHED_PREV_MSG",
    },
    # --- Section D: HIV status & risk screening ---------------------------
    {
        "code": "BONELA_KP_KNOWS_HIV_STATUS",
        "question": "Do you know your HIV status?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_LAST_TEST",
        "question": "When last did you test?",
        "type": "text",
        "category": "hiv_prevention",
        "required": False,
    },
    {
        "code": "BONELA_KP_UNPROT_SEX_PLHIV",
        "question": "Have you had unprotected sex with a person living with HIV / someone whose status is unknown?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_MULTI_PARTNER_3M",
        "question": "In the past 3 months, have you had unprotected sex with more than one partner?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_EXPOSURE_72H",
        "question": "Did you have a possible HIV exposure in the last 72 hours?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_EXPOSURE_TYPE",
        "question": "What type of exposure was it?",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": [
            "Unprotected sex",
            "Condom break/slip",
            "Needle stick/blood contact",
            "Sexual assault",
        ],
        "required": False,
        "depends_on": "BONELA_KP_EXPOSURE_72H",
    },
    {
        "code": "BONELA_KP_TRANSACTIONAL_SEX_3M",
        "question": "Have you received money / goods in exchange for sex in the past 3 months?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_FORCED_SEX_3M",
        "question": "In the past 3 months, were you forced to have sex against your will?",
        "type": "yes_no",
        "category": "gbv",
    },
    {
        "code": "BONELA_KP_PHYSICAL_VIOLENCE_3M",
        "question": "In the past 3 months, have you been hit, punched, kicked, slapped, choked or hurt by someone?",
        "type": "yes_no",
        "category": "gbv",
    },
    {
        "code": "BONELA_KP_EMOTIONAL_ABUSE",
        "question": "Does anyone say hurtful or demeaning things to make you feel bad about yourself?",
        "type": "yes_no",
        "category": "gbv",
    },
    {
        "code": "BONELA_KP_THREATENED_HARM",
        "question": "Are you or your loved ones threatened with harm if you don't do what someone says?",
        "type": "yes_no",
        "category": "gbv",
    },
    {
        "code": "BONELA_KP_STI_SYMPTOMS_3M",
        "question": "Have you experienced any symptoms of STIs in the past 3 months?",
        "type": "yes_no",
        "category": "sti",
    },
    {
        "code": "BONELA_KP_STI_TREATED_3M",
        "question": "Have you been treated for STIs in the past 3 months?",
        "type": "yes_no",
        "category": "sti",
    },
    # --- Section E: Substance use -----------------------------------------
    {
        "code": "BONELA_KP_USED_DRUGS_3M",
        "question": "Have you used drugs in the past 3 months?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_DRUGS_USED",
        "question": "Which drugs do you currently use?",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": ["Heroin", "Cocaine", "Methamphetamine", "Cannabis", "Other"],
        "required": False,
        "depends_on": "BONELA_KP_USED_DRUGS_3M",
    },
    {
        "code": "BONELA_KP_DRUGS_OTHER",
        "question": "If other, please specify",
        "type": "text",
        "category": "hiv_prevention",
        "required": False,
        "depends_on": "BONELA_KP_USED_DRUGS_3M",
    },
    {
        "code": "BONELA_KP_USE_METHOD",
        "question": "What is your preferred method of use?",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Injecting", "Smoking", "Swallowing", "Sniffing"],
        "required": False,
        "depends_on": "BONELA_KP_USED_DRUGS_3M",
    },
    {
        "code": "BONELA_KP_USE_FREQUENCY",
        "question": "How often do you use drugs?",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Daily", "Weekly", "Occasionally"],
        "required": False,
        "depends_on": "BONELA_KP_USED_DRUGS_3M",
    },
    {
        "code": "BONELA_KP_INJECTS_DRUGS",
        "question": "Do you currently inject drugs?",
        "type": "yes_no",
        "category": "hiv_prevention",
        "required": False,
        "depends_on": "BONELA_KP_USED_DRUGS_3M",
    },
    {
        "code": "BONELA_KP_SHARES_EQUIPMENT",
        "question": "Do you share needles, syringes, or other injecting equipment?",
        "type": "yes_no",
        "category": "hiv_prevention",
        "required": False,
        "depends_on": "BONELA_KP_INJECTS_DRUGS",
    },
    # --- Section F: Stigma -------------------------------------------------
    {
        "code": "BONELA_KP_EXPERIENCED_STIGMA_3M",
        "question": "Have you experienced stigma or discrimination in the past 3 months?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    {
        "code": "BONELA_KP_STIGMA_STOPPED_HELP",
        "question": "Have your experiences / concerns about potential stigma or judgement ever stopped you from seeking help?",
        "type": "yes_no",
        "category": "hiv_prevention",
    },
    # --- Section G: Topic discussed & presentation ------------------------
    {
        "code": "BONELA_KP_TOPIC_DISCUSSED",
        "question": "Topic discussed",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": [
            "STIs",
            "Human Rights",
            "HIV Prevention",
            "HTS",
            "GBV",
            "Stigma reduction",
            "Legal Aid Services",
            "PrEP",
            "PEP",
            "NCDs",
            "Treatment Literacy",
            "Condom Use",
            "HIV Treatment",
            "ARV Based Prevention",
            "EMTCT",
            "Other",
        ],
    },
    {
        "code": "BONELA_KP_PRESENTATION_CONTENT",
        "question": "Content of presentation",
        "type": "text",
        "category": "hiv_prevention",
        "required": False,
    },
    # --- Section H: Referrals made ----------------------------------------
    {
        "code": "BONELA_KP_REFERRALS_MADE",
        "question": "Referrals made",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": [
            "HTS",
            "GBV (physical)",
            "GBV (PSS)",
            "GBV (sexual violence)",
            "GBV (clinical services)",
            "GBV (emotional)",
            "GBV (justice) / Legal services",
            "Justice services",
            "STI",
            "PrEP",
            "PEP",
            "NCD",
            "Social Protection",
        ],
        "required": False,
    },
    # --- Section I: Linked for care ---------------------------------------
    {
        "code": "BONELA_KP_LINKED_FOR_CARE",
        "question": "Linked for care",
        "type": "multiselect",
        "category": "hiv_prevention",
        "options": [
            "HTS",
            "GBV (physical)",
            "GBV (PSS)",
            "GBV (sexual violence)",
            "GBV (clinical services)",
            "GBV (emotional)",
            "GBV (justice) / Legal services",
            "Justice services",
            "STI",
            "PrEP",
            "PEP",
            "NCD",
            "Social Protection",
        ],
        "required": False,
    },
    # --- Section J: Commodities distributed -------------------------------
    {
        "code": "BONELA_KP_CONDOMS_MALE",
        "question": "Number of condoms distributed (Male)",
        "type": "number",
        "category": "hiv_prevention",
        "required": False,
    },
    {
        "code": "BONELA_KP_CONDOMS_FEMALE",
        "question": "Number of condoms distributed (Female)",
        "type": "number",
        "category": "hiv_prevention",
        "required": False,
    },
    {
        "code": "BONELA_KP_CONDOM_COLLECT_FREQ",
        "question": "How many times have you collected condoms in the past month?",
        "type": "select",
        "category": "hiv_prevention",
        "options": ["Once", "2-3 times", "4-5 times", "More than 5 times"],
        "required": False,
    },
    {
        "code": "BONELA_KP_CONDOM_DIST_POINT",
        "question": "Condom distribution point",
        "type": "text",
        "category": "hiv_prevention",
        "required": False,
    },
    {
        "code": "BONELA_KP_IEC_NUMBER",
        "question": "IEC distributed: Number",
        "type": "number",
        "category": "media",
        "required": False,
    },
    {
        "code": "BONELA_KP_IEC_TYPE",
        "question": "IEC distributed: Type",
        "type": "text",
        "category": "media",
        "required": False,
    },
    {
        "code": "BONELA_KP_IEC_MESSAGE",
        "question": "IEC distributed: Message",
        "type": "text",
        "category": "media",
        "required": False,
    },
    {
        "code": "BONELA_KP_LUBRICANTS",
        "question": "Number of lubricants distributed",
        "type": "number",
        "category": "hiv_prevention",
        "required": False,
    },
]


def _options_payload(labels):
    """Build the {value,label} option list stored on the indicator/question."""
    return [{"value": label, "label": label} for label in labels]


class Command(BaseCommand):
    help = "Seed the BONELA Individual Outreach Form (KP) as an Assessment."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created/updated without writing to the database.",
        )
        parser.add_argument(
            "--org-codes",
            default="",
            help=(
                "Comma-separated organization codes to link the assessment to. "
                "Empty (default) leaves the assessment cross-cutting (all orgs)."
            ),
        )
        parser.add_argument(
            "--indicator-org-codes",
            default="",
            help=(
                "Comma-separated organization codes used as the default org link "
                "for every question's indicator. Empty (default) leaves questions "
                "cross-cutting unless a question defines its own 'orgs' list."
            ),
        )

    def _resolve_orgs(self, codes):
        """Return (orgs, missing_codes) for a list/iterable of org codes."""
        orgs = []
        missing = []
        for code in codes:
            code = code.strip()
            if not code:
                continue
            org = Organization.objects.filter(code=code).first()
            if org is None:
                missing.append(code)
            else:
                orgs.append(org)
        return orgs, missing

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        assessment_org_codes = [c for c in options["org_codes"].split(",") if c.strip()]
        default_indicator_org_codes = [
            c for c in options["indicator_org_codes"].split(",") if c.strip()
        ]

        assessment_orgs, missing = self._resolve_orgs(assessment_org_codes)
        if missing:
            self.stdout.write(
                self.style.WARNING(
                    f"Unknown organization code(s) for --org-codes, skipped: {', '.join(missing)}"
                )
            )
        default_indicator_orgs, missing = self._resolve_orgs(default_indicator_org_codes)
        if missing:
            self.stdout.write(
                self.style.WARNING(
                    f"Unknown organization code(s) for --indicator-org-codes, skipped: "
                    f"{', '.join(missing)}"
                )
            )

        if not assessment_orgs and not default_indicator_orgs and not any(
            q.get("orgs") for q in QUESTIONS
        ):
            self.stdout.write(
                "No organizations linked — form is cross-cutting (visible to all orgs)."
            )

        codes = [q["code"] for q in QUESTIONS]
        if len(set(codes)) != len(codes):
            raise ValueError("Duplicate indicator codes in QUESTIONS definition.")

        with transaction.atomic():
            questions_by_code = {}
            created_i = updated_i = 0

            for q in QUESTIONS:
                options_payload = (
                    _options_payload(q["options"]) if q.get("options") else []
                )
                defaults = {
                    "text": q["question"],
                    "help_text": q.get("help", ""),
                    "response_type": q["type"],
                    "options": options_payload,
                    "category": q.get("category", "hiv_prevention"),
                    # Cross-cutting bank questions; no indicator roll-up by default.
                    "aggregate_mode": "none",
                    "is_active": True,
                }
                # Resolve this question's org link: explicit per-question "orgs"
                # overrides the CLI default; empty means cross-cutting.
                if "orgs" in q:
                    q_orgs, q_missing = self._resolve_orgs(q.get("orgs") or [])
                    if q_missing:
                        self.stdout.write(
                            self.style.WARNING(
                                f"  {q['code']}: unknown org code(s) skipped: "
                                f"{', '.join(q_missing)}"
                            )
                        )
                else:
                    q_orgs = default_indicator_orgs

                question = Question.objects.filter(code=q["code"]).first()
                if question is None:
                    if not dry_run:
                        question = Question.objects.create(code=q["code"], **defaults)
                        question.organizations.set(q_orgs)
                    created_i += 1
                else:
                    if not dry_run:
                        for field, value in defaults.items():
                            setattr(question, field, value)
                        question.save()
                        question.organizations.set(q_orgs)
                    updated_i += 1
                questions_by_code[q["code"]] = question

            # Assessment
            assessment = Assessment.objects.filter(name=ASSESSMENT_NAME).first()
            if assessment is None:
                if not dry_run:
                    assessment = Assessment.objects.create(
                        name=ASSESSMENT_NAME,
                        description=ASSESSMENT_DESCRIPTION,
                        is_active=True,
                    )
                    assessment.organizations.set(assessment_orgs)
                self.stdout.write(self.style.SUCCESS(f"Assessment created: {ASSESSMENT_NAME}"))
            else:
                if not dry_run:
                    assessment.description = ASSESSMENT_DESCRIPTION
                    assessment.is_active = True
                    assessment.save()
                    assessment.organizations.set(assessment_orgs)
                self.stdout.write(self.style.SUCCESS(f"Assessment updated: {ASSESSMENT_NAME}"))

            # Question placements (first pass: create/update without depends_on)
            created_q = updated_q = 0
            link_by_code = {}
            for order, q in enumerate(QUESTIONS, start=1):
                question = questions_by_code[q["code"]]
                aq_defaults = {
                    "order": order,
                    "is_required": q.get("required", True),
                }
                if dry_run or assessment is None or question is None:
                    # In dry-run the assessment/question may be unsaved.
                    continue
                link, was_created = AssessmentQuestion.objects.update_or_create(
                    assessment=assessment,
                    question=question,
                    defaults=aq_defaults,
                )
                link_by_code[q["code"]] = link
                if was_created:
                    created_q += 1
                else:
                    updated_q += 1

            # Second pass: wire depends_on now that all links exist.
            if not dry_run:
                for q in QUESTIONS:
                    parent_code = q.get("depends_on")
                    if not parent_code:
                        continue
                    child = link_by_code.get(q["code"])
                    parent = link_by_code.get(parent_code)
                    if child and parent:
                        child.depends_on = parent
                        child.condition_value = True
                        child.save(update_fields=["depends_on", "condition_value"])

            if dry_run:
                self.stdout.write(
                    self.style.WARNING(
                        f"[DRY RUN] Would seed {len(QUESTIONS)} questions: "
                        f"{created_i} new bank questions, {updated_i} existing. "
                        "No changes written."
                    )
                )
                transaction.set_rollback(True)
            else:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Done. Bank questions: {created_i} created, {updated_i} updated. "
                        f"Form placements: {created_q} created, {updated_q} updated. "
                        f"Total questions on form: {len(QUESTIONS)}."
                    )
                )
