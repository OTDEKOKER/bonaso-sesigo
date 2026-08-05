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
  type: string // text | note | select_one | select_multiple | ...
  label: string
  hint: string | null
  required: boolean
  multiline: boolean
  relevant: Cond | null
  constraint: Cond | null
  list?: string
  choices?: Choice[]
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

export type Answers = Record<string, string>

/** Evaluate a relevance/constraint condition against current answers. */
export function condSatisfied(cond: Cond | null | undefined, answers: Answers): boolean {
  if (!cond) return true
  if (cond.raw !== undefined) return true // unparsed expression — show by default
  const actual = String(answers[cond.field ?? ""] ?? "")
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
      if (value !== undefined && value !== "") payload[field.name] = value
    }
  }
  return payload
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
