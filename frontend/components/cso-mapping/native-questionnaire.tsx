"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Pencil,
  Send,
} from "lucide-react"

import { api } from "@/lib/api"
import {
  type Answers,
  type Field,
  type FormSchema,
  type Section,
  buildPayload,
  fieldIsActive,
  fieldLabel,
  findNote,
  validateStep,
  visibleSteps,
} from "@/components/cso-mapping/schema"

const ACCENT = "#356a8d"
const ACCENT_DARK = "#2b5872"

// Approved BONASO support contacts (also shown on the /cso-mapping intro page).
const SUPPORT_EMAIL = "info@bonaso.org"
const SUPPORT_PHONE = "+267 317 0582"

// Per-field mobile keyboard + autofill hints.
type InputMode = "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
const INPUT_ATTRS: Record<string, { type?: string; inputMode?: InputMode; autoComplete?: string }> = {
  respondent_phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
  respondent_email: { type: "email", inputMode: "email", autoComplete: "email" },
  responding_entity: { autoComplete: "organization" },
  respondent_name: { autoComplete: "name" },
  respondent_position: { autoComplete: "organization-title" },
  primary_district: { autoComplete: "address-level2" },
}

interface Receipt {
  reference: string
  submitted_at: string
  responding_entity: string
}

function newAttemptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function choiceLabel(field: Field, value: string): string {
  return field.choices?.find((c) => c.name === value)?.label ?? value
}

/**
 * Native, Sesigo-hosted CSO Mapping questionnaire.
 *
 * Fetches the form schema from the backend and renders it as a paged wizard with
 * conditional branching (Annex 2/3/4 by respondent type), a review step, and a
 * receipt. Responses POST to Sesigo's own API — nothing leaves in-country
 * infrastructure. A per-attempt client_submission_id makes submission idempotent.
 */
export function NativeQuestionnaire() {
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [answers, setAnswers] = useState<Answers>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [attemptId, setAttemptId] = useState<string>(() => newAttemptId())
  const topRef = useRef<HTMLDivElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    setLoadError(false)
    api
      .get<FormSchema>("/cso-mapping/schema/")
      .then(({ data }) => {
        if (active) setSchema(data)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
    }
  }, [])

  const steps = useMemo(() => (schema ? visibleSteps(schema, answers) : []), [schema, answers])
  const consentDeclined = answers.consent === "no"
  const showReview = answers.consent === "yes" && steps.length > 1
  const maxIndex = Math.max(steps.length - 1 + (showReview ? 1 : 0), 0)
  const safeIndex = Math.min(stepIndex, maxIndex)
  const onReviewStep = showReview && safeIndex === steps.length
  const currentStep: Section | undefined = onReviewStep ? undefined : steps[safeIndex]
  const isLastFormStep = safeIndex === steps.length - 1

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  const focusErrorSummary = () =>
    requestAnimationFrame(() => errorSummaryRef.current?.focus())

  const setAnswer = (name: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const jumpToField = (name: string) => {
    const el = document.getElementById(`cso-field-${name}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
    const focusable = el?.querySelector<HTMLElement>("input, textarea")
    focusable?.focus()
  }

  const goNext = () => {
    if (!currentStep) return
    const stepErrors = validateStep(currentStep, answers)
    if (Object.keys(stepErrors).length) {
      setErrors(stepErrors)
      focusErrorSummary()
      return
    }
    setErrors({})
    setStepIndex(safeIndex + 1)
    scrollTop()
  }

  const goBack = () => {
    setErrors({})
    setSubmitError(null)
    setStepIndex(Math.max(safeIndex - 1, 0))
    scrollTop()
  }

  const goToStep = (index: number) => {
    setErrors({})
    setStepIndex(index)
    scrollTop()
  }

  const resetForAnother = () => {
    setAnswers({})
    setErrors({})
    setSubmitError(null)
    setReceipt(null)
    setStepIndex(0)
    setAttemptId(newAttemptId())
    scrollTop()
  }

  const submit = async () => {
    if (!schema) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { data } = await api.post<Receipt>("/cso-mapping/submit/", {
        ...buildPayload(schema, answers),
        client_submission_id: attemptId,
      })
      setReceipt(data)
      scrollTop()
    } catch (err) {
      const fieldErrors = (err as { errors?: unknown })?.errors
      if (fieldErrors && typeof fieldErrors === "object" && !Array.isArray(fieldErrors)) {
        const mapped: Record<string, string> = {}
        for (const [key, val] of Object.entries(fieldErrors as Record<string, unknown>)) {
          mapped[key] = Array.isArray(val) ? String(val[0]) : String(val)
        }
        setErrors(mapped)
        const firstBadStep = steps.findIndex((s) => s.fields.some((f) => mapped[f.name]))
        if (firstBadStep >= 0) setStepIndex(firstBadStep)
      }
      setSubmitError(
        "We could not submit your responses. Please review the highlighted fields and try again, or contact BONASO if the problem continues.",
      )
      scrollTop()
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">The questionnaire could not be loaded.</p>
          <p className="max-w-sm text-xs leading-5 text-slate-500">
            Please check your connection and refresh the page. If the problem continues, contact
            BONASO for assistance.
          </p>
        </div>
      </Card>
    )
  }

  if (!schema) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">Loading the questionnaire…</p>
        </div>
      </Card>
    )
  }

  if (receipt) {
    return (
      <div ref={topRef}>
        <SubmissionReceipt receipt={receipt} onAnother={resetForAnother} />
      </div>
    )
  }

  const totalSteps = steps.length + (showReview ? 1 : 0)
  const errorNames = currentStep
    ? currentStep.fields.filter((f) => errors[f.name]).map((f) => f.name)
    : []

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      <ProgressBar current={safeIndex + 1} total={totalSteps} />

      {submitError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{submitError}</p>
        </div>
      ) : null}

      {onReviewStep ? (
        <ReviewStep
          answers={answers}
          steps={steps}
          onEdit={goToStep}
          onBack={goBack}
          onSubmit={submit}
          submitting={submitting}
        />
      ) : (
        <Card>
          {errorNames.length > 0 ? (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 outline-none"
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                Please fix {errorNames.length} {errorNames.length === 1 ? "field" : "fields"}:
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm">
                {errorNames.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => jumpToField(name)}
                      className="text-left text-red-700 underline underline-offset-2 hover:text-red-900"
                    >
                      {fieldLabel(schema, name) ?? name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {currentStep?.label ? (
            <h2 className="mb-1 text-lg font-bold leading-snug" style={{ color: ACCENT_DARK }}>
              {currentStep.label}
            </h2>
          ) : null}

          <div className="mt-4 flex flex-col gap-6">
            {currentStep?.fields.map((field) =>
              fieldIsActive(currentStep, field, answers) ? (
                <FieldControl
                  key={field.name}
                  field={field}
                  value={answers[field.name] ?? ""}
                  error={errors[field.name]}
                  onChange={(v) => setAnswer(field.name, v)}
                />
              ) : null,
            )}

            {consentDeclined ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {findNote(schema, "no_consent") ??
                    "Thank you. The assessment cannot continue because consent was not provided."}
                </p>
                <p className="mt-1.5 text-xs text-amber-700">
                  No information has been stored. You can change your answer or leave this page.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAnswer("consent", "")
                      goToStep(0)
                    }}
                    className="rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Change my answer
                  </button>
                  <Link
                    href="/cso-mapping"
                    className="rounded-lg px-3.5 py-2 text-sm font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
                  >
                    Return to introduction
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={safeIndex === 0}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:invisible"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>

            {consentDeclined ? null : isLastFormStep && showReview ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: ACCENT }}
              >
                Review answers
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: ACCENT }}
              >
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
  )
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>
          Step {current} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: ACCENT }}
        />
      </div>
    </div>
  )
}

/** Fix D: review every answer, grouped by section, with an Edit link per section. */
function ReviewStep({
  answers,
  steps,
  onEdit,
  onBack,
  onSubmit,
  submitting,
}: {
  answers: Answers
  steps: Section[]
  onEdit: (index: number) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
}) {
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-bold" style={{ color: ACCENT_DARK }}>
        <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        Review your answers
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Please check your responses before submitting. Use “Edit” to change any section.
      </p>

      <div className="mt-5 space-y-6">
        {steps.map((section, index) => {
          const entries = section.fields
            .filter((f) => f.type !== "note" && fieldIsActive(section, f, answers))
            .map((f) => ({
              field: f,
              value:
                f.type === "select_one"
                  ? choiceLabel(f, answers[f.name] ?? "")
                  : (answers[f.name] ?? ""),
            }))
            .filter((e) => e.value !== "")
          if (entries.length === 0) return null
          return (
            <div key={section.name} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#2b5872]">
                  {section.label ?? "Details"}
                </h3>
                <button
                  type="button"
                  onClick={() => onEdit(index)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#356a8d] hover:text-[#2b5872]"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </button>
              </div>
              <dl className="space-y-2.5">
                {entries.map(({ field, value }) => (
                  <div key={field.name}>
                    <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: ACCENT }}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {submitting ? "Submitting…" : "Submit questionnaire"}
        </button>
      </div>
    </Card>
  )
}

/** Fix G: receipt with a public reference and approved BONASO support contact. */
function SubmissionReceipt({ receipt, onAnother }: { receipt: Receipt; onAnother: () => void }) {
  const submitted = new Date(receipt.submitted_at)
  const submittedText = Number.isNaN(submitted.getTime())
    ? receipt.submitted_at
    : submitted.toLocaleString()
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
        <h2 className="text-lg font-bold" style={{ color: ACCENT_DARK }}>
          Response received
        </h2>
        <p className="max-w-md text-sm leading-6 text-slate-600">
          Thank you. Your response has been securely received and stored on the Sesigo Data Portal.
        </p>
      </div>

      <dl className="mx-auto max-w-md space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Reference</dt>
          <dd className="font-mono font-semibold text-slate-800">{receipt.reference}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Submitted</dt>
          <dd className="text-slate-800">{submittedText}</dd>
        </div>
        {receipt.responding_entity ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Organisation</dt>
            <dd className="text-right text-slate-800">{receipt.responding_entity}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mx-auto mt-4 max-w-md text-center text-xs leading-5 text-slate-500">
        Please keep your reference number. If you need assistance, contact BONASO at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-[#356a8d] underline">
          {SUPPORT_EMAIL}
        </a>{" "}
        or{" "}
        <a href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`} className="font-medium text-[#356a8d] underline">
          {SUPPORT_PHONE}
        </a>
        .
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/cso-mapping"
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Return to introduction
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="inline-flex min-h-[44px] items-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: ACCENT }}
        >
          Submit another response
        </button>
      </div>
    </Card>
  )
}

function FieldControl({
  field,
  value,
  error,
  onChange,
}: {
  field: Field
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  if (field.type === "note") {
    if (field.name === "thank_you") return null // shown on the receipt screen
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        {field.label}
      </div>
    )
  }

  const hintId = field.hint ? `${field.name}-hint` : undefined
  const errorId = error ? `${field.name}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined
  const attrs = INPUT_ATTRS[field.name] ?? {}

  const errorNode = error ? (
    <p id={errorId} className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {error}
    </p>
  ) : null

  // Radio group: use a fieldset/legend so the question is the group's accessible name.
  if (field.type === "select_one") {
    return (
      <fieldset id={`cso-field-${field.name}`} aria-describedby={describedBy}>
        <legend className="text-sm font-semibold text-slate-800">
          {field.label}
          {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </legend>
        {field.hint ? (
          <p id={hintId} className="mt-0.5 text-xs text-slate-500">
            {field.hint}
          </p>
        ) : null}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(field.choices ?? []).map((choice) => {
            const selected = value === choice.name
            return (
              <label
                key={choice.name}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                  selected
                    ? "border-[#356a8d] bg-[#eef4f8] text-[#2b5872]"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name={field.name}
                  value={choice.name}
                  checked={selected}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-4 w-4 accent-[#356a8d]"
                />
                {choice.label}
              </label>
            )
          })}
        </div>
        {errorNode}
      </fieldset>
    )
  }

  return (
    <div id={`cso-field-${field.name}`}>
      <label htmlFor={field.name} className="block text-sm font-semibold text-slate-800">
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {field.hint ? (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500">
          {field.hint}
        </p>
      ) : null}

      <div className="mt-2">
        {field.multiline ? (
          <textarea
            id={field.name}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#356a8d] focus:ring-2 focus:ring-[#356a8d]/30"
          />
        ) : (
          <input
            id={field.name}
            type={attrs.type ?? "text"}
            inputMode={attrs.inputMode}
            autoComplete={attrs.autoComplete}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#356a8d] focus:ring-2 focus:ring-[#356a8d]/30"
          />
        )}
      </div>

      {errorNode}
    </div>
  )
}
