/**
 * Types + helpers for the CSO Mapping form schema.
 *
 * The schema is generated on the backend from the KoboToolbox XLSForm and served
 * at GET /api/cso-mapping/schema/. Both ends render/validate against the same
 * definition, so the questionnaire only has to be maintained in one place.
 */

export interface Choice {
  name: string
  label: string
}

/** Parsed `${field} = 'value'` (or `. = 'value'`) condition; `raw` for anything unparsed. */
export interface Cond {
  field?: string
  op?: string
  value?: string
  raw?: string
}

export interface Field {
  name: string
  type: string // text | note | select_one | select_multiple | funding_sources | ...
  label: string
  hint: string | null
  required: boolean
  multiline: boolean
  relevant: Cond | null
  constraint: Cond | null
  list?: string
  choices?: Choice[]
  // Composite "funding_sources" fields carry their record layout here.
  sub_fields?: Field[]
  item_label?: string
  placeholder?: string | null
}

export interface Section {
  name: string
  label: string | null
  relevant: Cond | null
  appearance?: string | null
  fields: Field[]
}

export interface FormSchema {
  id_string: string
  version: string
  title: string
  default_language: string
  sections: Section[]
  choices: Record<string, Choice[]>
}

// One record of a "funding_sources" composite answer (funder_name, project_name,
// scope, period — all optional strings).
export type FundingItem = Record<string, string>

// A single-choice / text answer is a string; a multi-select answer is a list of
// choice names; a funding_sources answer is a list of records. All live in the
// same answers map.
export type AnswerValue = string | string[] | FundingItem[]
export type Answers = Record<string, AnswerValue>

/** True if a value is a list of funding records (vs a list of choice strings). */
export function asFundingItems(value: AnswerValue | undefined): FundingItem[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "object") as FundingItem[]) : []
}

/** Whether a funding record carries any non-empty value. */
export function fundingItemHasContent(item: FundingItem | undefined): boolean {
  return !!item && Object.values(item).some((v) => String(v ?? "").trim() !== "")
}

/** Selected options of a (possibly multi-select) answer, as a string list. */
export function asList(value: AnswerValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string") as string[]
  return value != null && value !== "" ? [String(value)] : []
}

/** Evaluate a relevance/constraint condition against current answers. */
export function condSatisfied(cond: Cond | null | undefined, answers: Answers): boolean {
  if (!cond) return true
  if (cond.raw !== undefined) return true // unparsed expression — show by default
  const raw = answers[cond.field ?? ""]
  if (cond.op === "selected") {
    return asList(raw).map(String).includes(cond.value ?? "")
  }
  const actual = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw ?? "")
  if (cond.op === "ne") return actual !== cond.value
  return actual === cond.value
}

/** A field is active only when its section and its own relevance both hold. */
export function fieldIsActive(section: Section, field: Field, answers: Answers): boolean {
  return condSatisfied(section.relevant, answers) && condSatisfied(field.relevant, answers)
}

/** Sections that should render as a step: relevant now and holding a real question. */
export function visibleSteps(schema: FormSchema, answers: Answers): Section[] {
  return schema.sections.filter(
    (s) => condSatisfied(s.relevant, answers) && s.fields.some((f) => f.type !== "note"),
  )
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Client-side validation for one step; returns { fieldName: message }. */
export function validateStep(section: Section, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of section.fields) {
    if (field.type === "note") continue
    if (!fieldIsActive(section, field, answers)) continue
    if (field.type === "select_multiple") {
      if (field.required && asList(answers[field.name]).length === 0) {
        errors[field.name] = "Please select at least one option."
      }
      continue
    }
    if (field.type === "funding_sources") {
      const items = asFundingItems(answers[field.name])
      const filled = items.filter(fundingItemHasContent)
      const requiredSubs = (field.sub_fields ?? []).filter((s) => s.required)
      const itemLabel = field.item_label || "funding source"
      if (field.required && filled.length === 0) {
        errors[field.name] = `Please add at least one ${itemLabel}.`
      } else if (filled.some((it) => requiredSubs.some((s) => !String(it[s.name] ?? "").trim()))) {
        const label = requiredSubs[0]?.label ?? "the required field"
        errors[field.name] = `Please provide ${label} for each ${itemLabel}.`
      }
      continue
    }
    const value = String(answers[field.name] ?? "").trim()
    if (field.required && !value) {
      errors[field.name] = "This field is required."
      continue
    }
    if (field.constraint && value) {
      const target =
        field.constraint.field === "." ? value : String(answers[field.constraint.field ?? ""] ?? "")
      if (target !== field.constraint.value) {
        errors[field.name] = "This must be confirmed before you can continue."
        continue
      }
    }
    if (field.name === "respondent_email" && value && !EMAIL_RE.test(value)) {
      errors[field.name] = "Enter a valid email address."
    }
  }
  return errors
}

/** Flatten every active answer into the payload the submit endpoint expects. */
export function buildPayload(schema: FormSchema, answers: Answers): Answers {
  const payload: Answers = {}
  for (const section of schema.sections) {
    if (!condSatisfied(section.relevant, answers)) continue
    for (const field of section.fields) {
      if (field.type === "note") continue
      if (!fieldIsActive(section, field, answers)) continue
      const value = answers[field.name]
      if (value === undefined) continue
      if (field.type === "funding_sources") {
        const items = asFundingItems(value).filter(fundingItemHasContent)
        if (items.length > 0) payload[field.name] = items
      } else if (Array.isArray(value)) {
        if (value.length > 0) payload[field.name] = value
      } else if (value !== "") {
        payload[field.name] = value
      }
    }
  }
  return payload
}

// Each SELECTED option may carry an OPTIONAL free-text comment, stored under
// "<field>__comment__<option>" (a convention shared with the backend).
export const COMMENT_SEP = "__comment__"
export function commentKey(field: string, option: string): string {
  return `${field}${COMMENT_SEP}${option}`
}
export function commentPrefix(field: string): string {
  return `${field}${COMMENT_SEP}`
}
// Comments are offered on substantive choice questions, not the consent/final gates.
const NO_COMMENT_FIELDS = new Set(["consent", "information_confirmed"])
export function supportsComment(field: Field): boolean {
  return (
    (field.type === "select_one" || field.type === "select_multiple") &&
    !NO_COMMENT_FIELDS.has(field.name)
  )
}

/** The set per-option comments for a field, as {label, text} pairs (for display). */
export function answerComments(field: Field, answers: Answers): { label: string; text: string }[] {
  const prefix = commentPrefix(field.name)
  const labelOf = (name: string) => field.choices?.find((c) => c.name === name)?.label ?? name
  const out: { label: string; text: string }[] = []
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith(prefix) && typeof v === "string" && v.trim()) {
      out.push({ label: labelOf(k.slice(prefix.length)), text: v })
    }
  }
  return out
}

/** A display string for a stored answer: multi-select joined, choice codes labelled. */
export function displayAnswer(field: Field, value: AnswerValue | undefined): string {
  const label = (name: string) => field.choices?.find((c) => c.name === name)?.label ?? name
  if (field.type === "funding_sources") {
    const subs = field.sub_fields ?? []
    const keys = subs.length ? subs.map((s) => s.name) : ["funder_name", "project_name", "scope", "period"]
    const labelOf = (k: string) => subs.find((s) => s.name === k)?.label ?? k
    return asFundingItems(value)
      .map((it, i) => {
        const parts = keys
          .map((k) => [labelOf(k), String(it[k] ?? "").trim()] as const)
          .filter(([, v]) => v)
          .map(([l, v]) => `${l}: ${v}`)
        return parts.length ? `${i + 1}. ${parts.join("; ")}` : ""
      })
      .filter(Boolean)
      .join("\n")
  }
  if (field.type === "select_multiple") return asList(value).map(label).join(", ")
  if (field.type === "select_one") return label(typeof value === "string" ? value : "")
  return typeof value === "string" ? value : ""
}

/** The label of any field (or note) in the schema, by field name. */
export function fieldLabel(schema: FormSchema, name: string): string | null {
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.name === name) return field.label
    }
  }
  return null
}

/** The display-only note in the schema keyed by field name (e.g. no_consent). */
export function findNote(schema: FormSchema, name: string): string | null {
  return fieldLabel(schema, name)
}

// ── Office GPS location ──────────────────────────────────────────────────────
// The location is captured by a dedicated widget (browser Geolocation API), not
// as a schema field. Its values live in `answers` under these reserved keys so
// they persist across sections and draft saves. `cso_office_location` is the
// synthetic error key the backend/UI use for the required-location message.
export const LOCATION_ERROR_KEY = "cso_office_location"
export const LOCATION_FIELDS = [
  "latitude",
  "longitude",
  "location_accuracy",
  "location_captured_at",
  "location_capture_method",
] as const

/** True when both coordinates are present and are finite, in valid range. */
export function hasValidLocation(answers: Answers): boolean {
  const latRaw = answers.latitude
  const lngRaw = answers.longitude
  if (typeof latRaw !== "string" || typeof lngRaw !== "string" || !latRaw || !lngRaw) return false
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/** Just the set location keys, for merging into the submit payload. */
export function locationPayload(answers: Answers): Answers {
  const out: Answers = {}
  for (const key of LOCATION_FIELDS) {
    const value = answers[key]
    if (typeof value === "string" && value !== "") out[key] = value
  }
  return out
}
