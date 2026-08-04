"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, Send } from "lucide-react"

import { api } from "@/lib/api"
import {
  type Answers,
  type Field,
  type FormSchema,
  type Section,
  buildPayload,
  fieldIsActive,
  findNote,
  validateStep,
  visibleSteps,
} from "@/components/cso-mapping/schema"

const ACCENT = "#356a8d"
const ACCENT_DARK = "#2b5872"

/**
 * Native, Sesigo-hosted CSO Mapping questionnaire.
 *
 * Fetches the form schema from the backend and renders it as a paged wizard with
 * conditional branching (Annex 2/3/4 by respondent type). Responses POST to
 * Sesigo's own API — nothing leaves in-country infrastructure.
 */
export function NativeQuestionnaire() {
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [answers, setAnswers] = useState<Answers>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

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
  const safeIndex = Math.min(stepIndex, Math.max(steps.length - 1, 0))
  const currentStep: Section | undefined = steps[safeIndex]
  const isLastStep = safeIndex === steps.length - 1
  const consentDeclined = answers.consent === "no"

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })

  const setAnswer = (name: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const goNext = () => {
    if (!currentStep) return
    const stepErrors = validateStep(currentStep, answers)
    if (Object.keys(stepErrors).length) {
      setErrors(stepErrors)
      scrollTop()
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

  const submit = async () => {
    if (!schema || !currentStep) return
    const stepErrors = validateStep(currentStep, answers)
    if (Object.keys(stepErrors).length) {
      setErrors(stepErrors)
      scrollTop()
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.post("/cso-mapping/submit/", buildPayload(schema, answers))
      setDone(true)
      scrollTop()
    } catch (err) {
      const fieldErrors = (err as { errors?: unknown })?.errors
      if (fieldErrors && typeof fieldErrors === "object" && !Array.isArray(fieldErrors)) {
        const mapped: Record<string, string> = {}
        for (const [key, val] of Object.entries(fieldErrors as Record<string, unknown>)) {
          mapped[key] = Array.isArray(val) ? String(val[0]) : String(val)
        }
        setErrors(mapped)
        // Jump to the earliest step that contains a rejected field.
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

  if (!schema || !currentStep) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">Loading the questionnaire…</p>
        </div>
      </Card>
    )
  }

  if (done) {
    return (
      <div ref={topRef}>
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
            <h2 className="text-lg font-bold" style={{ color: ACCENT_DARK }}>
              Response submitted
            </h2>
            <p className="max-w-md text-sm leading-6 text-slate-600">
              {findNote(schema, "thank_you") ??
                "Thank you for completing the BONASO Health Service CSO Mapping and Capacity Assessment."}
            </p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      <ProgressBar current={safeIndex + 1} total={steps.length} />

      {submitError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{submitError}</p>
        </div>
      ) : null}

      <Card>
        {currentStep.label ? (
          <h2 className="mb-1 text-lg font-bold leading-snug" style={{ color: ACCENT_DARK }}>
            {currentStep.label}
          </h2>
        ) : null}

        <div className="mt-4 flex flex-col gap-6">
          {currentStep.fields.map((field) =>
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
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                {findNote(schema, "no_consent") ??
                  "Thank you. The assessment cannot continue because consent was not provided."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            onClick={goBack}
            disabled={safeIndex === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>

          {consentDeclined ? null : isLastStep ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? "Submitting…" : "Submit questionnaire"}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: ACCENT }}
            >
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </Card>
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
    if (field.name === "thank_you") return null // shown on the dedicated done screen
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        {field.label}
      </div>
    )
  }

  const describedBy = error ? `${field.name}-error` : field.hint ? `${field.name}-hint` : undefined

  return (
    <div>
      <label htmlFor={field.name} className="block text-sm font-semibold text-slate-800">
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </label>
      {field.hint ? (
        <p id={`${field.name}-hint`} className="mt-0.5 text-xs text-slate-500">
          {field.hint}
        </p>
      ) : null}

      <div className="mt-2">
        {field.type === "select_one" ? (
          <fieldset className="flex flex-wrap gap-2" aria-describedby={describedBy}>
            {(field.choices ?? []).map((choice) => {
              const selected = value === choice.name
              return (
                <label
                  key={choice.name}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
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
          </fieldset>
        ) : field.multiline ? (
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
            type={field.name === "respondent_email" ? "email" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#356a8d] focus:ring-2 focus:ring-[#356a8d]/30"
          />
        )}
      </div>

      {error ? (
        <p id={`${field.name}-error`} className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
