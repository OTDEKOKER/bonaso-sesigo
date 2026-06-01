export type CanonicalIndicatorStage =
  | "screened"
  | "eligible"
  | "tested"
  | "positive"
  | "referred"
  | "linked"
  | "service"
  | "messaging"
  | "support"
  | "other";

export type CanonicalIndicatorDefinition = {
  key: string;
  label: string;
  stage: CanonicalIndicatorStage;
  aliases: string[];
};

export const CANONICAL_INDICATOR_MAP: CanonicalIndicatorDefinition[] = [
  {
    key: "hiv_tested",
    label: "Tested for HIV",
    stage: "tested",
    aliases: [
      "Number of people tested for HIV.",
      "Number of Number of people tested for HIV.",
      "HIVPM_HIV_TESTED",
      "Number of people tested for HIV",
    ],
  },
  {
    key: "hiv_positive",
    label: "Tested HIV Positive",
    stage: "positive",
    aliases: [
      "Number of people who tested positive for HIV.",
      "Number of people who tested positive for HIV",
      "Number of people who tested positiv...",
    ],
  },
  {
    key: "hiv_screened",
    label: "Screened for HIV",
    stage: "screened",
    aliases: ["HIVPM_HIV_SCREENED", "Screened for HIV"],
  },
  {
    key: "tb_screened",
    label: "Screened for TB",
    stage: "screened",
    aliases: ["HIVPM_TB_SCREENED", "Number of PLHIV screened for TB"],
  },
  {
    key: "pep_assessed",
    label: "Assessed for PEP Eligibility",
    stage: "eligible",
    aliases: ["Number of people who were assessed for PEP eligibility"],
  },
  {
    key: "prep_assessed",
    label: "Assessed for PrEP Eligibility",
    stage: "eligible",
    aliases: ["Number of people who were assessed for PrEP eligibility"],
  },
  {
    key: "pep_eligible",
    label: "Eligible for PEP",
    stage: "eligible",
    aliases: ["Eligible for PEP", "Number of people eligible for PEP", "HIVPM_PEP_ELIGIBLE"],
  },
  {
    key: "prep_eligible",
    label: "Eligible for PrEP",
    stage: "eligible",
    aliases: ["Eligible for PrEP", "Number of people eligible for PrEP", "HIVPM_PREP_ELIGIBLE"],
  },
  {
    key: "referred_hiv_testing",
    label: "Referred for HIV Testing",
    stage: "referred",
    aliases: [
      "Number of people referred for HIV testing.",
      "Number of people referred for HIV Testing.",
      "AUTO_NUMBER_OF_PEOPLE_REFERRED_FOR_HIV_",
    ],
  },
  {
    key: "referred_pep",
    label: "Referred for PEP",
    stage: "referred",
    aliases: ["Number of people referred for PEP."],
  },
  {
    key: "referred_prep",
    label: "Referred for PrEP",
    stage: "referred",
    aliases: ["Number of people referred for PrEP."],
  },
  {
    key: "linked_to_care",
    label: "Linked to Care",
    stage: "linked",
    aliases: ["Linked to care", "Number of people linked to care.", "HIVPM_LINKED_TO_CARE"],
  },
  {
    key: "linked_justice_services",
    label: "Linked to Justice Services",
    stage: "linked",
    aliases: [
      "Number of people linked to justice services",
      "Number of people linked to justice services.",
      "Number of Number of people linked to justice services",
    ],
  },
  {
    key: "plhiv_referred_legal",
    label: "PLHIV Referred for Legal Services",
    stage: "service",
    aliases: [
      "Number of PLHIV referred to seek legal services",
      "Number of PLHIV referred for legal services",
    ],
  },
  {
    key: "plhiv_tb_referred",
    label: "PLHIV Symptomatic for TB Referred",
    stage: "referred",
    aliases: [
      "Number of PLHIV symptomatic for TB referred for testing",
      "Number of PLHIV symptomatic for TB referred",
    ],
  },
  {
    key: "provided_legal_aid",
    label: "Provided with Legal Aid Services",
    stage: "service",
    aliases: [
      "Number of people provided with legal aid services",
      "Number of people provided with legal aid services.",
      "Number of Number of people provided with legal aid services",
      "Number of PLWHs provided with legal services",
    ],
  },
  {
    key: "gbv_screened",
    label: "Screened for GBV",
    stage: "screened",
    aliases: [
      "Number of individuals screened for GBV.",
      "Number of individuals eligible for GBV screening",
    ],
  },
  {
    key: "gbv_eligible",
    label: "Eligible for GBV Services",
    stage: "eligible",
    aliases: ["Number eligible for GBV services.", "Number of individuals eligible for GBV services"],
  },
  {
    key: "gbv_eligible_clinical",
    label: "Eligible for GBV Clinical Services",
    stage: "eligible",
    aliases: [
      "Number eligible for clinical services for GBV",
      "Number of people elligible for clinical services for GBV.",
    ],
  },
  {
    key: "gbv_eligible_justice",
    label: "Eligible for GBV Justice Services",
    stage: "eligible",
    aliases: [
      "Number eligible for justice services for GBV",
      "Number of people elligible for justice services for GBV.",
    ],
  },
  {
    key: "gbv_eligible_psychosocial",
    label: "Eligible for GBV Psychosocial Support",
    stage: "eligible",
    aliases: [
      "Number eligible for pyschosocial services for GBV",
      "Number of people elligible for Psychosocial Support for GBV",
      "Number of People elligible for psychosocial support on GBV.",
    ],
  },
  {
    key: "gbv_referred_clinical",
    label: "Referred for GBV Clinical Services",
    stage: "referred",
    aliases: [
      "Number referred for clinical services for GBV",
      "Number of people reffered for clinical services for GBV.",
    ],
  },
  {
    key: "gbv_referred_justice",
    label: "Referred for GBV Justice Services",
    stage: "referred",
    aliases: [
      "Number referred for justice services for GBV",
      "Number of people reffered for justice services for GBV.",
    ],
  },
  {
    key: "gbv_referred_psychosocial",
    label: "Referred for GBV Psychosocial Support",
    stage: "referred",
    aliases: [
      "Number referred for pyschosocial services for GBV",
      "Number of people reffered for Psychosocial Support for GBV",
      "Number of People referred for psychosocial support on GBV",
    ],
  },
  {
    key: "gbv_received_psychosocial",
    label: "Received GBV Psychosocial Support",
    stage: "service",
    aliases: ["Number of people who received psychosocial support on GBV"],
  },
  {
    key: "gbv_messages_reached",
    label: "Reached with GBV Messages",
    stage: "messaging",
    aliases: ["Total Number of People Reached with GBV Messages"],
  },
  {
    key: "sti_screened",
    label: "Screened for STIs",
    stage: "screened",
    aliases: ["Number of people screened for STIs"],
  },
  {
    key: "sti_positive_referred",
    label: "STI Positive Cases Referred",
    stage: "referred",
    aliases: ["Number of people screened positive for STIs referred for services"],
  },
  {
    key: "sti_linked_to_care",
    label: "STI Cases Linked to Care",
    stage: "linked",
    aliases: ["Number of STI cases linked to care"],
  },
  {
    key: "sti_referrals_completed",
    label: "STI Referrals Completed",
    stage: "service",
    aliases: ["Number of STI cases referrals completed"],
  },
  {
    key: "ncd_screened",
    label: "Screened for NCDs",
    stage: "screened",
    aliases: [
      "Number of people screened for NCDs",
      "Number of people screened for NCDs risk factors",
      "Number of people screened for NCDs risk factors (blood glucose, blood pressure, BMI)",
    ],
  },
  {
    key: "ncd_referred",
    label: "Referred for NCD Services",
    stage: "referred",
    aliases: [
      "Number of people referred for NCD services",
      "Number of peoples referred for diabetes treatment/management services",
      "Number OF Peoples Referred FOR Diabetes Treatment/management Services BY Age,sex",
    ],
  },
  {
    key: "mental_health_screened",
    label: "Screened for Mental Health",
    stage: "screened",
    aliases: ["Number OF People Screened FOR Mental Health."],
  },
  {
    key: "mental_health_referred",
    label: "Referred for Mental Health Management/Treatment Services",
    stage: "referred",
    aliases: ["Number of people referred for mental health management/treatment services"],
  },
  {
    key: "counselling_sessions",
    label: "Counselling Sessions Conducted",
    stage: "service",
    aliases: [
      "Number OF Counselling Sessions Conducted",
      "Number of individual counselling sessions conducted for youth and vulnerable groups (15f)",
      "Number of individual counselling sessions conducted for youth and vulnerable groups (15h)",
      "Number of trauma-informed counselling sessions delivered to PLHIV, GBV survivors, adolescents, and youth",
    ],
  },
  {
    key: "people_receiving_counselling",
    label: "People Receiving Counselling",
    stage: "service",
    aliases: ["Number OF People Receiving Counselling."],
  },
  {
    key: "hiv_messages_reached",
    label: "Number of People Reached with HIV Messages",
    stage: "messaging",
    aliases: [
      "Reached with HIV prevention and control messages",
      "Total Number of People Reached with HIV Messages",
      "Number of Total Number of People Reached with HIV Messages",
    ],
  },
  {
    key: "hiv_testing_messages_reached",
    label: "Reached with HIV Testing Messages",
    stage: "messaging",
    aliases: ["Total Number of People Reached with HIV Testing Messages"],
  },
  {
    key: "pep_messages_reached",
    label: "Reached with PEP Messages",
    stage: "messaging",
    aliases: [
      "Total Number of People Reached with PEP Messages",
      "Number of Total Number of People Reached with PEP Messages",
    ],
  },
  {
    key: "prep_messages_reached",
    label: "Reached with PrEP Messages",
    stage: "messaging",
    aliases: ["Total Number of People Reached with PrEP Messages"],
  },
  {
    key: "condoms_distributed",
    label: "Condoms Distributed",
    stage: "service",
    aliases: [
      "Number of condoms distributed",
      "Number of Male Condoms distributed",
      "Number of condoms distributed to KVPs.",
      "Number of condoms distributed through the non-traditional sites",
    ],
  },
  {
    key: "lubricants_distributed",
    label: "Lubricants Distributed",
    stage: "service",
    aliases: [
      "Total number of lubricants distributed",
      "Number of Lubricants distributed to PLHIV",
    ],
  },
  {
    key: "rights_messages_reached",
    label: "Reached with Equality and Human Rights Messages",
    stage: "messaging",
    aliases: [
      "Number of individuals reached with messaging on equality and human rights",
      "Number of people sensitised on basic human rights and HIV.",
    ],
  },
  {
    key: "rights_violations_reported",
    label: "Reported Rights Violations",
    stage: "other",
    aliases: ["Number of people who report that their rights were violated"],
  },
  {
    key: "rights_redress_sought",
    label: "Sought Redress for Rights Violations",
    stage: "service",
    aliases: [
      "Number of people who report that their rights were violated and who sought redness",
      "Number of people who sought redress.",
    ],
  },
  {
    key: "art_defaulters_followed_14_89",
    label: "ART Defaulters Followed (14-89 Days)",
    stage: "support",
    aliases: [
      "Number of ART defaulters (14-89 days) given by facility for tracing",
      "Number of ART defaulters (14-89 days) followed",
    ],
  },
  {
    key: "art_defaulters_reinitiated_14_89",
    label: "ART Defaulters Reinitiated (14-89 Days)",
    stage: "linked",
    aliases: ["Number of ART defaulters (14-89 days) reinitiated to treatment"],
  },
  {
    key: "ltfu_followed_90_plus",
    label: "LTFU Followed (90+ Days)",
    stage: "support",
    aliases: [
      "Number of LTFU(90+ days) given by facility for tracing",
      "Number of LTFU(90+ days) followed",
    ],
  },
  {
    key: "ltfu_reinitiated_90_plus",
    label: "LTFU Reinitiated (90+ Days)",
    stage: "linked",
    aliases: ["Number of people who LTFU (90+ days) Re-initiated on ART"],
  },
  {
    key: "initiated_on_art",
    label: "Initiated on ART",
    stage: "linked",
    aliases: ["Number of people initiated on ART", "Number of AYP initiated on ART"],
  },
  {
    key: "ayp_linked_to_care",
    label: "AYP Linked to Care",
    stage: "linked",
    aliases: ["Number of AYP linked to care."],
  },
];

export function normalizeIndicatorText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[._,;:!?()[\]{}"/\\-]+/g, " ")
    .replace(/\belligible\b/g, "eligible")
    .replace(/\breffered\b/g, "referred")
    .replace(/\bpyschosocial\b/g, "psychosocial")
    .replace(/\bdescrimination\b/g, "discrimination")
    .replace(/\bcoodinators\b/g, "coordinators")
    .replace(/\bperforamance\b/g, "performance")
    .replace(/\bidentifies needs\b/g, "identified needs")
    .replace(/\bfield visists\b/g, "field visits")
    .replace(/\bvirsual presentations\b/g, "visual presentations")
    .replace(/\bredness\b/g, "redress")
    .replace(/\bnumber of number of people\b/g, "number of people")
    .replace(/\bnumber of\s+number of\b/g, "number of")
    .replace(/\bnumber of number of\b/g, "number of")
    .replace(/\btotal number of\b/g, "number of")
    .replace(/\bnumber number\b/g, "number")
    .replace(/\bpeoples\b/g, "people")
    .replace(/\s+/g, " ")
    .trim();
}

const CANONICAL_INDICATOR_LOOKUP = new Map<string, CanonicalIndicatorDefinition>();

for (const indicator of CANONICAL_INDICATOR_MAP) {
  const variants = [indicator.key, indicator.label, ...indicator.aliases];
  for (const variant of variants) {
    CANONICAL_INDICATOR_LOOKUP.set(normalizeIndicatorText(variant), indicator);
  }
}

export function resolveCanonicalIndicator(input: string) {
  return CANONICAL_INDICATOR_LOOKUP.get(normalizeIndicatorText(input)) ?? null;
}
