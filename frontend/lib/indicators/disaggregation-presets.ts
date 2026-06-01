export type AggregateDisaggregationDimension = {
  key: string
  label: string
  values: string[]
}

export type AggregateDisaggregationConfig = {
  enabled: boolean
  layout: "none" | "list" | "matrix" | "nested-matrix"
  dimensions: AggregateDisaggregationDimension[]
  notes?: string
}

export type DisaggregationPresetKey =
  | "sex"
  | "age_band_long"
  | "age_band_bonela"
  | "age_band_short"
  | "key_population"
  | "alcohol_use"
  | "tobacco_use"
  | "family_planning"
  | "community_leaders"
  | "social_media_platform"
  | "non_traditional_sites"
  | "ncd_prevention_messages"
  | "mental_health_management_treatment_services"
  | "counselling_sessions"
  | "receiving_counselling"
  | "ncd_screening"
  | "condom_type"
  | "activity_type"
  | "referral_type"
  | "location"
  | "target_group"

export const DISAGGREGATION_PRESETS: Record<
  DisaggregationPresetKey,
  AggregateDisaggregationDimension
> = {
  sex: {
    key: "sex",
    label: "Sex",
    values: ["Male", "Female"],
  },

  age_band_long: {
    key: "age_band",
    label: "Age Range",
    values: [
      "10-14",
      "15-19",
      "20-24",
      "25-29",
      "30-34",
      "35-39",
      "40-44",
      "45-49",
      "50-54",
      "55-59",
      "60-64",
      "65+",
    ],
  },

  age_band_bonela: {
    key: "age_band",
    label: "Age Range",
    values: [
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20-24",
      "25-29",
      "30-34",
      "35-39",
      "40-44",
      "45-49",
      "50-54",
      "55-59",
      "60-64",
      "65+",
    ],
  },

  age_band_short: {
    key: "age_band",
    label: "Age Range",
    values: ["15-19", "20-24", "25+"],
  },

  key_population: {
    key: "key_population",
    label: "Key Population",
    values: ["GENERAL POP.", "FSW", "MSM", "PWID", "PWD", "LGBTQI+"],
  },

  alcohol_use: {
    key: "alcohol_use",
    label: "Alcohol Use",
    values: ["Alcohol Use"],
  },

  tobacco_use: {
    key: "tobacco_use",
    label: "Tobacco Use",
    values: ["Tobacco Use"],
  },

  family_planning: {
    key: "family_planning",
    label: "Family Planning",
    values: [
      "Condom Counselling",
      "Oral Contraceptives",
      "Injectables",
      "Implants",
      "IUD",
      "Referral",
    ],
  },

  community_leaders: {
    key: "community_leaders",
    label: "Community Leaders",
    values: ["Traditional Leaders", "Religious Leaders", "Community Leaders"],
  },

  social_media_platform: {
    key: "social_media_platform",
    label: "Social Media Platform",
    values: [
      "Facebook",
      "WhatsApp",
      "Twitter",
      "Instagram",
      "TikTok",
      "Radio",
      "TV",
      "Community Media",
    ],
  },

  non_traditional_sites: {
    key: "non_traditional_sites",
    label: "Non Traditional Sites",
    values: [
      "Bars",
      "Taxi Ranks",
      "Schools",
      "Markets",
      "Churches",
      "Community Events",
      "Sports Events",
    ],
  },

  ncd_prevention_messages: {
    key: "ncd_prevention_messages",
    label: "NCD Prevention Messages",
    values: [
      "Alcohol Reduction messages",
      "Tobacco Control messages",
      "Physical Activity messages",
      "Healthy Diet messages",
      "Weight Management messages",
      "Blood Pressure messages",
      "Blood glucose messages",
      "Waist circumference messages",
      "Psychosocial",
    ],
  },

  mental_health_management_treatment_services: {
    key: "mental_health_management_treatment_services",
    label: "Mental Health Management/Treatment Services",
    values: [
      "Clinical care (Diagnosis, psychiatric medication, and therapy)",
      "Psychosocial support (Counseling, peer support, and education)",
      "Rehabilitation (Recovery programs, skills training, and community reintegration)",
      "Crisis services (Suicide prevention, emergency care, and inpatient treatment)",
      "Specialized care (Services for children, substance use, and co-occurring conditions)",
    ],
  },

  counselling_sessions: {
    key: "counselling_sessions",
    label: "Counselling Sessions",
    values: [
      "Individual Counselling",
      "Group Counselling",
      "Family Counselling",
      "Peer Counselling",
      "Follow-up Session",
    ],
  },

  receiving_counselling: {
    key: "mental_health_screening",
    label: "Mental Health Screening",
    values: ["Suicide", "Depression", "Anxiety", "Substance Use Disorders", "Psychosocial", "Living with a person with a mental health Illness", "Sleep Hygiene", "Others (state the type)"],
  },

  ncd_screening: {
    key: "ncd_screening",
    label: "NCD Screening",
    values: ["Blood Glucose", "Blood Pressure", "BMI", "Waist Circumference"],
  },

  condom_type: {
    key: "condom_type",
    label: "Condom Type",
    values: ["Male Condom", "Female Condom", "Braille-labelled Condom"],
  },

  activity_type: {
    key: "activity_type",
    label: "Activity Type",
    values: [
      "Advocacy",
      "Community Dialogue",
      "Campaign",
      "Engagement",
      "Training",
      "Workshop",
      "Meeting",
    ],
  },

  referral_type: {
    key: "referral_type",
    label: "Referral Type",
    values: [
      "HIV Testing",
      "STI Treatment",
      "GBV Services",
      "NCD Screening",
      "Mental Health",
      "Family Planning",
    ],
  },

  location: {
    key: "location",
    label: "Location",
    values: ["Urban", "Rural", "Peri-Urban", "Community", "Facility"],
  },

  target_group: {
    key: "target_group",
    label: "Target Group",
    values: [
      "Youth",
      "Adults",
      "Adolescents",
      "General Population",
      "Key Population",
      "People Living with HIV",
    ],
  },
}

export const DISAGGREGATION_PRESET_OPTIONS = [
  { value: "sex", label: "Sex" },
  { value: "age_band_long", label: "Age Range (Full)" },
  { value: "age_band_bonela", label: "Age Range (BONELA only)" },
  { value: "age_band_short", label: "Age Range (Short)" },
  { value: "key_population", label: "Key Population" },
  { value: "alcohol_use", label: "Alcohol Use" },
  { value: "tobacco_use", label: "Tobacco Use" },
  { value: "family_planning", label: "Family Planning" },
  { value: "community_leaders", label: "Community Leaders" },
  { value: "social_media_platform", label: "Social Media Platform" },
  { value: "non_traditional_sites", label: "Non Traditional Sites" },
  { value: "ncd_prevention_messages", label: "NCD Prevention Messages" },
  {
    value: "mental_health_management_treatment_services",
    label: "Mental Health Management/Treatment Services",
  },
  { value: "counselling_sessions", label: "Counselling Sessions" },
  { value: "receiving_counselling", label: "Mental Health Screening" },
  { value: "ncd_screening", label: "NCD Screening" },
  { value: "condom_type", label: "Condom Type" },
  { value: "activity_type", label: "Activity Type" },
  { value: "referral_type", label: "Referral Type" },
  { value: "location", label: "Location" },
  { value: "target_group", label: "Target Group" },
] as const

type PresetGroups = {
  rowPresetKeys: DisaggregationPresetKey[]
  columnPresetKeys: DisaggregationPresetKey[]
  bandPresetKeys: DisaggregationPresetKey[]
}

function cloneDimension(
  dimension: AggregateDisaggregationDimension,
): AggregateDisaggregationDimension {
  return {
    key: dimension.key,
    label: dimension.label,
    values: [...dimension.values],
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isBandPresetKey(key: DisaggregationPresetKey): boolean {
  return key === "age_band_long" || key === "age_band_bonela" || key === "age_band_short"
}

function isColumnPresetKey(key: DisaggregationPresetKey): boolean {
  return key === "sex"
}

function hasSameValues(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const leftSorted = [...left].map(normalizeText).sort()
  const rightSorted = [...right].map(normalizeText).sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function normalizeDimensionValuesForConsistency(
  key: string,
  label: string,
  values: string[],
): string[] {
  if (
    normalizeText(key) === "age band" &&
    normalizeText(label) === "age range" &&
    hasSameValues(values, DISAGGREGATION_PRESETS.age_band_bonela.values)
  ) {
    return [...DISAGGREGATION_PRESETS.age_band_long.values]
  }

  return values
}

export function getDisaggregationPreset(
  presetKey: DisaggregationPresetKey,
): AggregateDisaggregationDimension {
  return cloneDimension(DISAGGREGATION_PRESETS[presetKey])
}

export function groupPresetKeysForTableLayout(
  presetKeys: DisaggregationPresetKey[],
): PresetGroups {
  const uniqueKeys = Array.from(new Set(presetKeys))

  const rowPresetKeys = uniqueKeys.filter(
    (presetKey) => !isColumnPresetKey(presetKey) && !isBandPresetKey(presetKey),
  )
  const columnPresetKeys = uniqueKeys.filter((presetKey) => isColumnPresetKey(presetKey))
  const bandPresetKeys = uniqueKeys.filter((presetKey) => isBandPresetKey(presetKey))

  return {
    rowPresetKeys,
    columnPresetKeys,
    bandPresetKeys,
  }
}

export function normalizePresetKeysForTableLayout(
  presetKeys: DisaggregationPresetKey[],
): DisaggregationPresetKey[] {
  const grouped = groupPresetKeysForTableLayout(presetKeys)
  return [...grouped.rowPresetKeys, ...grouped.columnPresetKeys, ...grouped.bandPresetKeys]
}

export function buildDisaggregationConfigFromPresetKeys(
  presetKeys: DisaggregationPresetKey[],
): AggregateDisaggregationConfig {
  const groupedPresetKeys = normalizePresetKeysForTableLayout(presetKeys)
  const dimensions = groupedPresetKeys.map(getDisaggregationPreset)

  if (dimensions.length === 0) {
    return {
      enabled: false,
      layout: "none",
      dimensions: [],
    }
  }

  return {
    enabled: true,
    layout:
      dimensions.length === 1
        ? "list"
        : dimensions.length === 2
          ? "matrix"
          : "nested-matrix",
    dimensions,
  }
}

/**
 * Converts old sub_labels like:
 * ["Sex", "Age Range", "KP"]
 * into a structured config with real labels.
 */
export function migrateLegacySubLabelsToConfig(
  subLabels?: string[] | null,
): AggregateDisaggregationConfig {
  if (!Array.isArray(subLabels) || subLabels.length === 0) {
    return {
      enabled: false,
      layout: "none",
      dimensions: [],
    }
  }

  const normalized = subLabels.map((value) => value.toLowerCase().trim())
  const presetKeys: DisaggregationPresetKey[] = []
  const hasGenericDisaggregate = normalized.some((value) =>
    ["disaggregate", "disaggregation", "service category", "service type"].includes(value),
  )

  const addPreset = (key: DisaggregationPresetKey) => {
    if (!presetKeys.includes(key)) presetKeys.push(key)
  }

  if (normalized.some((value) => value === "sex" || value === "male" || value === "female")) {
    addPreset("sex")
  }

  if (
    normalized.some(
      (value) =>
        value === "age range" ||
        value === "age band" ||
        /^\d{1,2}-\d{1,2}$/.test(value) ||
        value === "65+" ||
        value === "25+" ||
        value.includes("ayp"),
    )
  ) {
    addPreset("age_band_long")
  }

  if (
    normalized.some((value) =>
      [
        "kp",
        "key population",
        "gen pop",
        "fsw",
        "msm",
        "pwid",
        "pwids",
        "pwd",
        "lgbtqi+",
        "young men",
        "agyw",
      ].includes(value),
    )
  ) {
    addPreset("key_population")
  }

  if (
    normalized.some((value) =>
      [
        "alcohol use",
        "alcohol",
        "drinks alcohol",
        "hazardous use",
      ].includes(value),
    )
  ) {
    addPreset("alcohol_use")
  }

  if (
    normalized.some((value) =>
      [
        "tobacco use",
        "tobacco",
        "smoking",
        "smokeless tobacco",
      ].includes(value),
    )
  ) {
    addPreset("tobacco_use")
  }

  if (
    normalized.some((value) =>
      [
        "family planning",
        "condom counselling",
        "oral contraceptives",
        "injectables",
        "implants",
        "iud",
      ].includes(value),
    )
  ) {
    addPreset("family_planning")
  }

  if (
    normalized.some((value) =>
      ["community leaders", "traditional leaders", "religious leaders"].includes(value),
    )
  ) {
    addPreset("community_leaders")
  }

  if (
    normalized.some((value) =>
      [
        "social media platform",
        "facebook",
        "whatsapp",
        "twitter",
        "instagram",
        "tiktok",
        "radio",
        "tv",
        "community media",
      ].includes(value),
    )
  ) {
    addPreset("social_media_platform")
  }

  if (
    normalized.some((value) =>
      [
        "non traditional sites",
        "bars",
        "taxi ranks",
        "schools",
        "markets",
        "churches",
        "community events",
        "sports events",
      ].includes(value),
    )
  ) {
    addPreset("non_traditional_sites")
  }

  if (
    normalized.some((value) =>
      [
        "ncd prevention messages",
        "alcohol reduction messages",
        "tobacco control messages",
        "tobacco control mssages",
        "physical activity messages",
        "healthy diet messages",
        "weight management messages",
        "blood pressure messages",
        "blood glucose messages",
        "waist circumference messages",
      ].includes(value),
    )
  ) {
    addPreset("ncd_prevention_messages")
  }

  if (
    normalized.some((value) =>
      [
        "mental health management/treatment services",
        "mental health management treatment services",
        "clinical care",
        "psychosocial support",
        "rehabilitation",
        "crisis services",
        "specialized care",
      ].includes(value),
    )
  ) {
    addPreset("mental_health_management_treatment_services")
  }

  if (
    normalized.some((value) =>
      [
        "counselling sessions",
        "counseling sessions",
        "counselling session",
        "counseling session",
        "individual counselling",
        "individual counseling",
        "group counselling",
        "group counseling",
        "family counselling",
        "family counseling",
        "peer counselling",
        "peer counseling",
      ].includes(value),
    )
  ) {
    addPreset("counselling_sessions")
  }

  if (
    normalized.some((value) =>
      [
        "mental health screening",
        "mental health screened",
        "screened for mental health",
        "receiving counselling",
        "receiving counseling",
      ].includes(value),
    )
  ) {
    addPreset("receiving_counselling")
  }

  if (
    normalized.some((value) =>
      ["ncd screening", "blood pressure", "diabetes", "bmi", "cholesterol", "cancer screening"].includes(value),
    )
  ) {
    addPreset("ncd_screening")
  }

  if (
    normalized.some((value) =>
      ["condom type", "male condom", "female condom", "braille-labelled condom"].includes(value),
    )
  ) {
    addPreset("condom_type")
  }

  if (
    normalized.some((value) =>
      [
        "activity type",
        "advocacy",
        "community dialogue",
        "campaign",
        "engagement",
        "training",
        "workshop",
        "meeting",
      ].includes(value),
    )
  ) {
    addPreset("activity_type")
  }

  if (
    normalized.some((value) =>
      [
        "referral type",
        "hiv testing",
        "sti treatment",
        "gbv services",
        "mental health",
        "family planning",
      ].includes(value),
    )
  ) {
    addPreset("referral_type")
  }

  if (
    normalized.some((value) =>
      ["location", "urban", "rural", "peri-urban", "community", "facility"].includes(value),
    )
  ) {
    addPreset("location")
  }

  if (
    normalized.some((value) =>
      [
        "target group",
        "youth",
        "adults",
        "adolescents",
        "general population",
        "people living with hiv",
      ].includes(value),
    )
  ) {
    addPreset("target_group")
  }

  const groupedPresetKeys = groupPresetKeysForTableLayout(presetKeys)
  const hasPrimaryRowPreset = groupedPresetKeys.rowPresetKeys.length > 0
  if (hasGenericDisaggregate && !hasPrimaryRowPreset) {
    const baseConfig = buildDisaggregationConfigFromPresetKeys(presetKeys)
    const dimensions: AggregateDisaggregationDimension[] = [
      {
        key: "disaggregate",
        label: "Disaggregate",
        values: [],
      },
      ...baseConfig.dimensions,
    ]
    return {
      enabled: true,
      layout: inferLayoutFromDimensions(dimensions),
      dimensions,
    }
  }

  return buildDisaggregationConfigFromPresetKeys(presetKeys)
}

/**
 * Safely normalize an indicator's config.
 * Use this when reading from backend.
 */
export function normalizeAggregateDisaggregationConfig(
  config?: Partial<AggregateDisaggregationConfig> | null,
  fallbackSubLabels?: string[] | null,
): AggregateDisaggregationConfig {
  if (
    config &&
    Array.isArray(config.dimensions) &&
    typeof config.enabled === "boolean" &&
    typeof config.layout === "string"
  ) {
    return {
      enabled: config.enabled,
      layout:
        config.layout === "list" ||
        config.layout === "matrix" ||
        config.layout === "nested-matrix" ||
        config.layout === "none"
          ? config.layout
          : "none",
      dimensions: config.dimensions.map((dimension) => {
        const key = String(dimension.key || "").trim()
        const label = String(dimension.label || "").trim()
        const values = Array.isArray(dimension.values)
          ? dimension.values.map((value) => String(value).trim()).filter(Boolean)
          : []

        return {
          key,
          label,
          values: normalizeDimensionValuesForConsistency(key, label, values),
        }
      }),
      notes: config.notes ? String(config.notes) : undefined,
    }
  }

  return migrateLegacySubLabelsToConfig(fallbackSubLabels)
}

/**
 * Convenience helper for new indicators.
 */
export function createEmptyDisaggregationConfig(): AggregateDisaggregationConfig {
  return {
    enabled: false,
    layout: "none",
    dimensions: [],
  }
}

/**
 * Derive the correct layout from the number of dimensions.
 */
export function inferLayoutFromDimensions(
  dimensions: AggregateDisaggregationDimension[],
): AggregateDisaggregationConfig["layout"] {
  if (!dimensions.length) return "none"
  if (dimensions.length === 1) return "list"
  if (dimensions.length === 2) return "matrix"
  return "nested-matrix"
}

export function getLegacySubLabelsFromPresetKeys(
  presetKeys: DisaggregationPresetKey[],
): string[] {
  return normalizePresetKeysForTableLayout(presetKeys).map(
    (presetKey) => getDisaggregationPreset(presetKey).label,
  )
}

export function inferPresetKeyFromDimension(
  dimension: AggregateDisaggregationDimension,
): DisaggregationPresetKey | null {
  const dimensionKey = normalizeText(dimension.key)
  const dimensionLabel = normalizeText(dimension.label)
  const dimensionValues = (dimension.values || []).map((value) => String(value))

  if (dimensionKey === "age band" && dimensionLabel === "age range") {
    if (hasSameValues(dimensionValues, DISAGGREGATION_PRESETS.age_band_bonela.values)) {
      return "age_band_bonela"
    }
    if (hasSameValues(dimensionValues, DISAGGREGATION_PRESETS.age_band_short.values)) {
      return "age_band_short"
    }
    return "age_band_long"
  }

  const allPresetKeys = Object.keys(DISAGGREGATION_PRESETS) as DisaggregationPresetKey[]
  for (const presetKey of allPresetKeys) {
    const preset = DISAGGREGATION_PRESETS[presetKey]
    if (
      normalizeText(preset.key) === dimensionKey &&
      normalizeText(preset.label) === dimensionLabel
    ) {
      return presetKey
    }
  }

  // Backward-compatible fallback for older saved labels where the key is still stable.
  const sameKeyPresets = allPresetKeys.filter(
    (presetKey) => normalizeText(DISAGGREGATION_PRESETS[presetKey].key) === dimensionKey,
  )
  if (sameKeyPresets.length === 1) {
    return sameKeyPresets[0]
  }
  return null
}

export function getPresetKeysFromConfig(
  config?: AggregateDisaggregationConfig | null,
  fallbackSubLabels?: string[] | null,
): DisaggregationPresetKey[] {
  const normalized = normalizeAggregateDisaggregationConfig(config, fallbackSubLabels)
  const presetKeys: DisaggregationPresetKey[] = []
  normalized.dimensions.forEach((dimension) => {
    const inferredKey = inferPresetKeyFromDimension(dimension)
    if (inferredKey && !presetKeys.includes(inferredKey)) {
      presetKeys.push(inferredKey)
    }
  })
  return normalizePresetKeysForTableLayout(presetKeys)
}
