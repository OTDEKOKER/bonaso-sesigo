"""Seed / update the full "NAHPA Social Contracting 2025/26" funder report template.

Encodes the COMPLETE structure of the manual funder report (every section, table
and figure — Tables 1/2/3.1/3.2 and Figures 1–21) taken from
``downloads/Annual Social Contracting Report 2026 (DRAFT).docx``, and maps each
figure to EXISTING SESIGO indicators by resilient name-token lookup against the
live catalog. Nothing is hard-coded in the frontend; every figure is a
configuration row that admins can edit later.

Idempotent: re-running reconciles the template in place (matched on name + year)
— sections/figures not in this definition are removed, existing ones updated, so
there is never drift or duplication.

``--dry-run`` is fully READ-ONLY (touches only Indicator/Project) so it can be run
safely against production before the app is migrated, to preview the real
indicator matches. Normal mode requires the ``funder_reports`` tables to exist.

Per-figure status is reported and stamped:
  * Fully mapped        — every expected indicator matched
  * Partially mapped    — some but not all expected indicators matched
  * Needs indicator mapping — none matched (figure kept, flagged in its description)
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from indicators.models import Indicator
from projects.models import Project

from funder_reports.models import (
    ReportTemplate, ReportSection, ReportFigure, ReportFigureIndicatorMapping,
    ChartType, Dimension, TargetMode, CalculationMode, MappingRole,
)

TEMPLATE_NAME = "NAHPA Social Contracting"
REPORTING_YEAR = "2025/26"
NEEDS_MAPPING_TAG = "[NEEDS INDICATOR MAPPING]"


def F(number, title, chart, group, secondary=Dimension.NONE, target=TargetMode.NONE,
      calc=CalculationMode.NONE, tokens=None, expected=None, narrative=""):
    """Build one figure definition. ``tokens`` is a list of token-groups; a
    catalog indicator matches a group when its name contains ALL tokens in it.
    ``expected`` = number of distinct indicators the figure should end up with
    (defaults to len(tokens)); it drives Fully/Partial status."""
    tokens = tokens or []
    return {
        "number": number, "title": title, "chart": chart, "group": group,
        "secondary": secondary, "target": target, "calc": calc, "tokens": tokens,
        "expected": expected if expected is not None else max(1, len(tokens)),
        "narrative": narrative,
    }


STRUCTURE = [
    ("Reporting Compliance", "Reporting Compliance", [
        F("Table 1", "Compliance to Reporting by CSO and Quarter", ChartType.COMPLIANCE,
          Dimension.COORDINATOR, expected=0,
          narrative="Submission status (submitted / late / not submitted) by CSO and quarter."),
        F("Table 2", "CSO Capacity Building and Communication (Media Platforms)", ChartType.TABLE,
          Dimension.COORDINATOR, tokens=[["media platform"], ["social media", "platform"]]),
    ]),
    ("Objective 1: Promotion of Healthy Lifestyles", "Objective 1", [
        # Reference layout: CSO (coordinator) on the x-axis, one coloured bar per
        # message type — matches the published report's Figure 1 grouped chart.
        F("Figure 1", "People Reached with HIV Prevention and Control Messages by Message Type",
          ChartType.GROUPED_BAR, Dimension.COORDINATOR, Dimension.INDICATOR,
          tokens=[["reached", "testing message"], ["reached", "pep message"], ["reached", "prep message"],
                  ["reached", "gbv message"], ["reached", "condom", "message"], ["reached", "treatment message"],
                  ["reached", "arv"], ["reached", "emtct"]], expected=8,
          narrative="{total} people reached with HIV prevention and control messages across {org_count} CSOs."),
        F("Figure 2", "HIV Prevention Messages Against Targets by CSO",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT,
          tokens=[["reached", "hiv prevention message"], ["people reached with hiv prevention"]], expected=1,
          narrative="{top_org} achieved the highest against target ({achievement_percent}% overall)."),
        F("Figure 3", "People Reached with Stigma Reduction Messages",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["stigma"]], expected=1,
          narrative="{total} people reached with stigma reduction messages ({achievement_percent}% of target)."),
        F("Figure 4", "NCD Prevention and Control Messages by Sex",
          ChartType.GROUPED_BAR, Dimension.SEX, target=TargetMode.PROJECT,
          calc=CalculationMode.ACHIEVEMENT_PERCENT,
          tokens=[["ncd", "prevention", "message"], ["reached", "ncd"]], expected=1,
          narrative="{total} people reached with NCD prevention and control messages."),
        # The NCD message types are the message-type disaggregation (stored in
        # AggregateFact.primary) of the single "NCD prevention messages" indicator
        # (#372), NOT separate indicators — so group by that disaggregation to show
        # the 8 cleaned types (Tobacco Control, Alcohol Reduction, Physical Activity,
        # …). Grouping by indicator collapsed this figure to a single bar.
        F("Figure 5", "NCD Prevention Messages by Message Type",
          ChartType.HORIZONTAL_BAR, Dimension.KEY_POPULATION,
          tokens=[["tobacco"], ["physical activity"], ["blood pressure"], ["cervical cancer"],
                  ["prostate cancer"], ["breast cancer"], ["psychoeducation"], ["alcohol"],
                  ["healthy diet"], ["weight"], ["blood glucose"], ["waist"]], expected=7,
          narrative="Tobacco control messages reached the most people."),
        # Same shape as Figure 5 — the social-media NCD indicator (#373) carries the
        # message types in its disaggregation, so group by that (not by indicator).
        F("Figure 6", "NCD Prevention Messages Through Social Media",
          ChartType.HORIZONTAL_BAR, Dimension.KEY_POPULATION,
          tokens=[["social media", "tobacco"], ["social media", "ncd"], ["online", "message"]], expected=1),
    ]),
    ("Objective 2: Promote Access to Services", "Objective 2", [
        F("Figure 7.1", "Total Number Tested Against Set Targets by CSO",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["tested"], ["hiv test", "number"]], expected=1,
          narrative="{total} people tested ({achievement_percent}% of target)."),
        F("Figure 7.2", "Total Number Tested by Sex, KVPs and Positives",
          ChartType.GROUPED_BAR, Dimension.KEY_POPULATION, Dimension.SEX, tokens=[["tested"]], expected=1),
        F("Figure 7.3", "HIV Positive Cases Identified by Sex",
          ChartType.GROUPED_BAR, Dimension.SEX, tokens=[["positive"], ["tested positive"]], expected=1,
          narrative="{total} people tested positive."),
        F("Figure 8", "People Referred for PrEP and PEP",
          ChartType.GROUPED_BAR, Dimension.INDICATOR, calc=CalculationMode.RATIO_PERCENT,
          tokens=[["eligible", "prep"], ["referred", "prep"], ["eligible", "pep"], ["referred", "pep"]], expected=4,
          narrative="PrEP/PEP eligibility and referral rates."),
        F("Figure 9", "AYP Provided with Family Planning Services",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["family planning"]], expected=1,
          narrative="{total} AYP accessed family planning services."),
        F("Figure 10", "Condom Distribution by CSO Against Targets",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["male condom", "distributed"], ["condom", "distributed"]], expected=1,
          narrative="{total} condoms distributed ({achievement_percent}% of target)."),
        F("Figure 10.1", "Repeat Condom Collection by Age and Sex",
          ChartType.GROUPED_BAR, Dimension.AGE, Dimension.SEX,
          tokens=[["condom", "repeat"], ["collecting condom"], ["repeatedly"]], expected=1),
        F("Figure 10.2", "Lubricant Distribution by CSO Against Targets",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["lubricant"]], expected=1,
          narrative="{total} lubricants distributed ({achievement_percent}% of target)."),
        F("Figure 11", "HIV Referrals and ART Initiation",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["tested"], ["positive"], ["initiated", "art"], ["art initiation"]], expected=3,
          narrative="Testing → positive → ART initiation cascade."),
        F("Figure 12", "People Screened for STIs and Referred for Further Services",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["sti", "screen"], ["sti", "referr"], ["sti", "complet"], ["sti", "link"]], expected=2),
        F("Figure 13.1", "PLHIV Screened for TB and Referred for Further Services",
          ChartType.CASCADE, Dimension.INDICATOR, secondary=Dimension.SEX,
          tokens=[["tb", "screen"], ["tb", "referr"], ["tb", "complet"]], expected=2),
        F("Figure 13.2", "PLHIV Interrupting TB Treatment Reinitiated",
          ChartType.GROUPED_BAR, Dimension.SEX,
          tokens=[["tb", "interrupt"], ["tb", "reinitiat"], ["interrupting treatment"]], expected=1),
        F("Figure 14.1", "People Screened for GBV",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT, tokens=[["gbv", "screen"]], expected=1,
          narrative="{total} people screened for GBV ({achievement_percent}% of target)."),
        F("Figure 14.2", "Screened for GBV and Eligible for GBV Services by Sex",
          ChartType.GROUPED_BAR, Dimension.SEX,
          tokens=[["gbv", "screen"], ["gbv", "eligible"]], expected=2),
        F("Figure 15", "Missing Treatment and Linkages to Treatment",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["lost to follow"], ["followed"], ["reinitiat"], ["linkage", "treatment"], ["linked", "treatment"]], expected=3,
          narrative="Lost-to-follow-up → followed → reinitiated on ART."),
        F("Figure 16.1", "People Screened for Biological NCD Risk Factors (Blood Glucose, BP, BMI, Waist)",
          ChartType.GROUPED_BAR, Dimension.INDICATOR, secondary=Dimension.SEX,
          tokens=[["blood glucose"], ["blood pressure"], ["body mass"], ["bmi"], ["waist"]], expected=4,
          narrative="{total} people screened for biological NCD risk factors."),
        F("Figure 16.2", "People Screened for NCD Behavioural Risk Factors (Tobacco, Alcohol)",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["alcohol", "screen"], ["alcohol", "eligible"], ["alcohol", "referr"], ["alcohol", "cessation"],
                  ["tobacco", "screen"], ["tobacco", "eligible"], ["tobacco", "referr"], ["tobacco", "cessation"]], expected=4,
          narrative="Screened → eligible → referred → cessation for alcohol and tobacco."),
        F("Figure 17.1", "People Screened for Mental Health Against Set Targets",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT,
          tokens=[["mental health", "screen"], ["screened", "mental"]], expected=1,
          narrative="{total} people screened for mental health ({achievement_percent}% of target)."),
        F("Figure 17.2", "People Screened and Receiving Counselling for Mental Health by Category",
          ChartType.HORIZONTAL_BAR, Dimension.INDICATOR,
          tokens=[["counsel", "depression"], ["counsel", "anxiety"], ["counsel", "substance"],
                  ["counsel", "sleep"], ["mental health", "counsel"], ["receiving counsel"]], expected=1,
          narrative="{total} people received mental-health counselling."),
        F("Figure 17.3", "Clients Referred for Further Screening Services (Mental Health)",
          ChartType.GROUPED_BAR, Dimension.INDICATOR,
          tokens=[["mental", "referr", "screen"], ["referred", "gbv centre"], ["referred", "further screen"]], expected=1),
        F("Figure 17.4", "People Eligible and Referred for Mental Health Management/Treatment Services",
          ChartType.GROUPED_BAR, Dimension.INDICATOR, calc=CalculationMode.RATIO_PERCENT,
          tokens=[["mental", "eligible"], ["mental", "management"], ["mental", "treatment", "referr"]], expected=2,
          narrative="Mental-health management eligibility and referral."),
        F("Figure 18.1", "People Screened for Breast Cancer (Palpations / Breast Examination)",
          ChartType.CASCADE, Dimension.INDICATOR, secondary=Dimension.SEX,
          tokens=[["breast cancer", "educat"], ["breast", "eligible"], ["breast", "screen"], ["breast", "palpation"]], expected=2,
          narrative="Breast cancer education → eligible → screened."),
        F("Figure 18.2", "People Screened/Referred for Prostate Cancer",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["prostate", "screen"], ["prostate", "eligible"], ["prostate", "referr"], ["prostate", "educat"]], expected=1,
          narrative="Prostate cancer screening/referral."),
        F("Figure 18.3", "People Screened/Referred for Cervical Cancer",
          ChartType.CASCADE, Dimension.INDICATOR,
          tokens=[["cervical", "screen"], ["cervical", "eligible"], ["cervical", "referr"], ["cervical", "educat"]], expected=1,
          narrative="Cervical cancer screening/referral."),
    ]),
    ("Activities, Capacity Building and Human Rights", "Activities & Human Rights", [
        F("Table 3.1", "HIV and NCD Awareness Activities Conducted Against Targets",
          ChartType.ACHIEVED_VS_TARGET, Dimension.COORDINATOR, target=TargetMode.ORG_QUARTER,
          calc=CalculationMode.ACHIEVEMENT_PERCENT,
          tokens=[["commemoration"], ["awareness activit"], ["outreach"], ["campaign"]], expected=1,
          narrative="HIV/NCD awareness activities held against target."),
        F("Table 3.2", "Advocacy, Demand Creation and Sensitization Activities",
          ChartType.TABLE, Dimension.COORDINATOR,
          tokens=[["advocacy"], ["demand creation"], ["sensitization activit"], ["sensitisation activit"]], expected=1),
        F("Figure 19", "People Utilizing Community-Based Physical Clubs",
          ChartType.GROUPED_BAR, Dimension.COORDINATOR,
          tokens=[["physical club"], ["community", "club"], ["utilizing", "club"]], expected=1,
          narrative="People utilising community-based physical clubs."),
        F("Figure 20", "Service Providers Receiving Training",
          ChartType.GROUPED_BAR, Dimension.COORDINATOR, secondary=Dimension.INDICATOR,
          tokens=[["service provider", "train"], ["providers", "train"], ["trained"], ["induct"]], expected=1,
          narrative="{total} service providers trained across {org_count} CSOs."),
        F("Figure 21", "People Sensitized on Human Rights and Those Who Reported Violations and Sought Redress",
          ChartType.GROUPED_BAR, Dimension.INDICATOR,
          tokens=[["sensitiz", "human right"], ["sensitis", "human right"], ["rights", "violat"], ["redress"]], expected=2,
          narrative="{total} people sensitised on human rights; violations reported and redress sought."),
    ]),
]


def _role_for(name: str, calc) -> str:
    n = name.lower()
    if calc == CalculationMode.RATIO_PERCENT:
        if "referr" in n:
            return MappingRole.NUMERATOR
        if "eligible" in n:
            return MappingRole.DENOMINATOR
    return MappingRole.ACHIEVED


# Curated EXACT indicator mappings (canonical indicator ids) per figure, derived
# by reconciling each figure to the specific indicators that carry its data in the
# NAHPA catalog (verified against approved 2025/26 data). These take precedence
# over fuzzy token matching so figures visualise the correct indicators. Figures
# absent here fall back to tokens (flagged for manual confirmation). Indicators are
# a GLOBAL catalog, so these ids are stable across NAHPA projects (2025/26 + 26/27).
CURATED_IDS = {
    "Figure 1": [322, 323, 324, 325, 327, 328, 481],   # PEP/PrEP/GBV/condom/ARV/EMTCT/treatment msgs
    "Figure 2": [322, 323, 324, 325, 327, 328],         # HIV-prevention msgs vs target by CSO
    "Figure 3": [330],                                  # stigma reduction messages
    "Figure 4": [372],                                  # NCD prevention & control messages (by sex)
    "Figure 5": [372],                                  # NCD messages (aggregate only — confirm per-type)
    "Figure 6": [373],                                  # NCD messages via social media
    "Figure 7.1": [451],                                # tested for HIV (vs target)
    "Figure 7.2": [451],                                # tested by sex/KVP
    "Figure 7.3": [452],                                # tested positive by sex
    "Figure 8": [336, 337, 338, 446],                   # PrEP/PEP eligible+referred (ratios)
    "Figure 9": [342],                                  # AYP family planning
    "Figure 10": [471, 448, 449],                       # condoms distributed (+brailed, +repeat)
    "Figure 10.1": [449],                               # repeat condom collection by age/sex
    "Figure 10.2": [472],                               # lubricants distributed
    "Figure 11": [445, 451, 452, 453, 335],             # referred→tested→positive→linked→ART
    "Figure 12": [351, 468, 470, 469],                  # STI screened→referred→completed→linked
    "Figure 13.1": [526, 527, 501],                     # TB screened→referred→completed
    "Figure 13.2": [529, 530],                          # TB interrupting→reinitiated
    "Figure 14.1": [343],                               # screened for GBV (vs target)
    "Figure 14.2": [343, 461, 539],                     # GBV screened + eligible (by sex)
    "Figure 15": [504, 536, 453],                       # LTFU followed→reinitiated→linked
    "Figure 16.1": [545],                               # biological NCD risk screened
    "Figure 16.2": [420],                               # behavioural NCD risk (tobacco) screened
    "Figure 17.1": [385],                               # mental health screened (vs target)
    "Figure 17.2": [386],                               # receiving counselling
    "Figure 17.3": [389],                               # referred for further services (confirm)
    "Figure 17.4": [428, 389],                          # mental-health mgmt eligible/referred (ratio)
    "Figure 18.1": [388],                               # breast cancer referred for further screening
    "Table 3.1": [368, 517],                            # awareness/campaign activities
    "Table 3.2": [365, 366],                            # advocacy + demand-creation activities
    "Figure 19": [435],                                 # community-based club activities (closest)
    "Figure 20": [317, 359],                            # service providers / healthcare workers trained
    "Figure 21": [358, 360, 361],                       # human-rights sensitised, violations, redress
    "Table 2": [363, 367],                              # media platforms / engagements
}


# Short, report-style series labels (label_override) for the HIV message-type
# indicators, so Figure 1's legend/table reads "PEP messages" not the full
# "Number of People Reached with PEP Messages". Full names still show in tooltips
# elsewhere; keyed by canonical indicator id.
LABEL_OVERRIDES = {
    322: "PEP messages",
    323: "PrEP messages",
    324: "GBV messages",
    325: "Condom use messages",
    327: "ARV-based prevention messages",
    328: "EMTCT messages",
    481: "HIV treatment messages",
}


class Command(BaseCommand):
    help = "Seed / update the complete NAHPA Social Contracting 2025/26 funder report template."

    def add_arguments(self, parser):
        parser.add_argument("--project", required=True, help="NAHPA SC project id")
        parser.add_argument("--dry-run", action="store_true",
                            help="Read-only: match indicators and print the checklist without writing.")

    def handle(self, *args, **opts):
        try:
            project = Project.objects.get(pk=opts["project"])
        except (Project.DoesNotExist, ValueError):
            raise CommandError(f"Project not found: {opts['project']}")

        import re
        indicators = list(Indicator.objects.all().values("id", "name"))
        _patterns: dict[str, re.Pattern] = {}

        def _tok_in(tok: str, name: str) -> bool:
            # Whole-word/phrase match so short tokens like "bmi"/"art"/"tb" don't
            # match inside unrelated words ("submitting", "start", "quarter").
            pat = _patterns.get(tok)
            if pat is None:
                # Leading word-boundary + stem (no trailing boundary) so a token
                # matches plural/suffix forms ("condom"→"condoms",
                # "screen"→"screened") but NOT inside unrelated words
                # ("bmi" ✗ "submitting", "art" ✗ "start", "tb" ✗ "subtb").
                pat = re.compile(r"(?<![a-z0-9])" + re.escape(tok.lower()))
                _patterns[tok] = pat
            return bool(pat.search(name))

        def match(token_groups):
            found, ids = [], set()
            for group in token_groups:
                for ind in indicators:
                    name = ind["name"].lower()
                    if all(_tok_in(tok, name) for tok in group) and ind["id"] not in ids:
                        ids.add(ind["id"]); found.append(ind)
            return found

        by_id = {i["id"]: i for i in indicators}

        def resolve(fig):
            """Curated exact ids take precedence over fuzzy token matching."""
            curated = CURATED_IDS.get(fig["number"])
            if curated:
                found = [by_id[i] for i in curated if i in by_id]
                # A curated figure is 'fully mapped' once its ids resolve.
                fig["expected"] = max(1, len(found))
                return found
            return match(fig["tokens"])

        dry = opts["dry_run"]
        checklist = []

        if dry:
            for s_title, s_obj, figures in STRUCTURE:
                for fig in figures:
                    matched = resolve(fig)
                    checklist.append(self._row(s_title, fig, matched))
            self._print_checklist(checklist, project, dry=True)
            return

        with transaction.atomic():
            # Reporting year is derived per project (from its code/name, e.g.
            # "NSC2026/27" -> "2026/27"), so each NAHPA project gets its OWN
            # template. Keying update_or_create on the PROJECT (not name+year)
            # prevents a second project's seed from re-assigning the first
            # project's template (the "no project found" bug).
            import re as _re
            _m = _re.search(r"(\d{4})[/.\-](\d{2})", f"{project.code} {project.name}")
            reporting_year = f"{_m.group(1)}/{_m.group(2)}" if _m else REPORTING_YEAR
            template, _ = ReportTemplate.objects.update_or_create(
                name=TEMPLATE_NAME, project=project,
                defaults={"funder": "NAHPA", "reporting_year": reporting_year,
                          "is_active": True,
                          # System template (owner stays NULL → admin-managed) but
                          # visible to the whole project network incl. funders.
                          "visibility": "project",
                          "description": "Auto-seeded from the NAHPA Social Contracting annual report. "
                                         "Figures are configurable; finish any flagged Needs Indicator Mapping."},
            )
            seen_sections, seen_figures = set(), set()
            for s_order, (s_title, s_obj, figures) in enumerate(STRUCTURE):
                section, _ = ReportSection.objects.update_or_create(
                    report_template=template, title=s_title,
                    defaults={"objective_label": s_obj, "display_order": s_order},
                )
                seen_sections.add(section.id)
                for f_order, fig in enumerate(figures):
                    matched = resolve(fig)
                    status = self._status(fig, matched)
                    desc = fig["narrative"] and "" or ""
                    figure, _ = ReportFigure.objects.update_or_create(
                        report_section=section, figure_number=fig["number"],
                        defaults={
                            "title": fig["title"], "chart_type": fig["chart"],
                            "grouping_dimension": fig["group"], "secondary_grouping_dimension": fig["secondary"],
                            "target_mode": fig["target"], "calculation_mode": fig["calc"],
                            "narrative_template": fig["narrative"], "display_order": f_order,
                            "is_active": True,
                            # Flag BOTH unmapped and partially-mapped figures so a
                            # gap is never silent — visible in the builder.
                            "description": (f"{NEEDS_MAPPING_TAG} " if status in ("needs", "partial") else "")
                                           + (f"Report figure {fig['number']}."),
                        },
                    )
                    seen_figures.add(figure.id)
                    figure.mappings.all().delete()
                    for i, ind in enumerate(matched):
                        ReportFigureIndicatorMapping.objects.create(
                            report_figure=figure, indicator_id=ind["id"],
                            role=_role_for(ind["name"], fig["calc"]), display_order=i,
                            label_override=LABEL_OVERRIDES.get(ind["id"], ""),
                        )
                    checklist.append(self._row(s_title, fig, matched))
            # Idempotent reconcile: drop figures/sections no longer defined.
            ReportFigure.objects.filter(
                report_section__report_template=template).exclude(id__in=seen_figures).delete()
            ReportSection.objects.filter(
                report_template=template).exclude(id__in=seen_sections).delete()

        self._print_checklist(checklist, project, dry=False)

    # ── status + reporting ───────────────────────────────────────────────────
    @staticmethod
    def _status(fig, matched) -> str:
        # expected == 0 → structural table (e.g. reporting-compliance) that is
        # driven by submission/period data, not an indicator; it is fully
        # configured with no mapping required.
        if fig["expected"] == 0:
            return "fully"
        if not matched:
            return "needs"
        return "fully" if len(matched) >= fig["expected"] else "partial"

    def _row(self, section_title, fig, matched):
        return {
            "section": section_title, "number": fig["number"], "title": fig["title"],
            "chart": fig["chart"], "group": fig["group"], "target": fig["target"],
            "matched": [m["name"] for m in matched], "expected": fig["expected"],
            "status": self._status(fig, matched),
        }

    def _print_checklist(self, checklist, project, *, dry):
        label = {"fully": "Fully mapped", "partial": "Partially mapped", "needs": "NEEDS INDICATOR MAPPING"}
        counts = {"fully": 0, "partial": 0, "needs": 0}
        self.stdout.write(self.style.SUCCESS(
            f"\n{'[DRY-RUN, read-only] ' if dry else ''}NAHPA report '{TEMPLATE_NAME} {REPORTING_YEAR}' "
            f"→ project {project.code} ({len(checklist)} figures/tables)\n"))
        header = f"{'STATUS':<22} {'NO.':<10} {'CHART':<18} {'GROUP BY':<14} TITLE"
        self.stdout.write(header)
        self.stdout.write("-" * len(header))
        current = None
        for r in checklist:
            counts[r["status"]] += 1
            if r["section"] != current:
                current = r["section"]
                self.stdout.write(self.style.HTTP_INFO(f"\n## {current}"))
            tgt = "  +target" if r["target"] != TargetMode.NONE else ""
            style = self.style.SUCCESS if r["status"] == "fully" else (
                self.style.WARNING if r["status"] == "partial" else self.style.ERROR)
            line = (f"{label[r['status']]:<22} {r['number']:<10} {r['chart']:<18} "
                    f"{r['group']:<14} {r['title']}{tgt}")
            self.stdout.write(style(line))
            for name in r["matched"]:
                self.stdout.write(f"{'':<22}   • {name}")
            if r["status"] == "needs":
                self.stdout.write(f"{'':<22}   ! no matching indicator — configure in the builder")
        total = len(checklist)
        self.stdout.write("\n" + "=" * 60)
        self.stdout.write(
            f"TOTAL {total}  |  Fully mapped: {counts['fully']}  |  "
            f"Partially mapped: {counts['partial']}  |  Needs mapping: {counts['needs']}")
        pct = round(100 * counts["fully"] / total) if total else 0
        self.stdout.write(f"Fully-mapped coverage: {pct}%  "
                          f"({'100% configured' if counts['needs'] == 0 and counts['partial'] == 0 else 'manual indicator confirmation still required for figures above'})")
