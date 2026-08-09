"use client"

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  CloudOff,
  Loader2,
  MapPin,
  MessageSquarePlus,
  Navigation,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react"

import { api, fetchWithAuth } from "@/lib/api"
import {
  type AnswerValue,
  type Answers,
  type Field,
  type FormSchema,
  type Section,
  LOCATION_ERROR_KEY,
  answerComments,
  asList,
  buildPayload,
  commentKey,
  fieldIsActive,
  fieldLabel,
  findNote,
  hasValidLocation,
  locationPayload,
  supportsComment,
  validateStep,
  visibleSteps,
} from "@/components/cso-mapping/schema"

const ACCENT = "#356a8d"
const ACCENT_DARK = "#2b5872"
const TOKEN_KEY = "cso-mapping-draft-token" // stores ONLY the opaque token, never answers
const AUTOSAVE_DELAY = 1500

// The location-capture widget is anchored inside this section, directly below
// the "physical_address" question.
const LOCATION_SECTION = "administrative_information"
const LOCATION_ANCHOR_FIELD = "physical_address"
const LOCATION_REQUIRED_MSG =
  "The CSO office location is required. Please use the “Capture Current Location” button while at the office."
// A select_one with more options than this renders as a dropdown, not radios
// (keeps long lists such as the district selection usable).
const DROPDOWN_CHOICE_THRESHOLD = 8

const SUPPORT_EMAIL = "info@bonaso.org"
const SUPPORT_PHONE = "+267 317 0582"

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

interface DraftState {
  current_step: number
  form_version: string
  updated_at: string
  expires_at: string
  client_submission_id: string | null
  answers?: Answers
  resume_token?: string
}

type SaveStatus = "idle" | "saving" | "saved" | "error"

// Draft requests carry the resume token in the X-CSO-Draft-Token header — never
// in the URL. Uses fetchWithAuth so it shares the app's base URL/timeout handling.
async function draftFetch<T>(
  path: string,
  method: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  if (opts.token) headers["X-CSO-Draft-Token"] = opts.token
  const res = await fetchWithAuth(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* no JSON body */
    }
    const err = new Error(`Draft request failed (${res.status})`) as Error & {
      status: number
      errors?: unknown
    }
    err.status = res.status
    err.errors = body
    throw err
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
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

/** A single display string for any answer: multi-select joined, choices labelled. */
function displayValue(field: Field, value: AnswerValue | undefined): string {
  if (field.type === "select_multiple") {
    return asList(value)
      .map((v) => choiceLabel(field, v))
      .join(", ")
  }
  if (field.type === "select_one") {
    return choiceLabel(field, typeof value === "string" ? value : "")
  }
  return typeof value === "string" ? value : ""
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
function writeStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable — autosave still works for this session */
  }
}

/**
 * Native, Sesigo-hosted CSO Mapping questionnaire with secure server-side drafts.
 *
 * Answers autosave to Sesigo's DB behind an opaque resume token (only the token —
 * never the answers — is kept in the browser). A saved response can be resumed on
 * the same device automatically or on another device via its resume code.
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [resumePrompt, setResumePrompt] = useState<{ token: string; updatedAt: string } | null>(null)
  const [restoredNote, setRestoredNote] = useState(false)

  const topRef = useRef<HTMLDivElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const tokenRef = useRef<string | null>(null)
  const answersRef = useRef(answers)
  const stepRef = useRef(0)
  const attemptRef = useRef(attemptId)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Load schema, then look for a saved draft on this device.
  useEffect(() => {
    let active = true
    setLoadError(false)
    api
      .get<FormSchema>("/cso-mapping/schema/")
      .then(async ({ data }) => {
        if (!active) return
        setSchema(data)
        const stored = readStoredToken()
        if (stored) {
          try {
            const draft = await draftFetch<DraftState>("/cso-mapping/drafts/current/", "GET", {
              token: stored,
            })
            if (active) setResumePrompt({ token: stored, updatedAt: draft.updated_at })
          } catch {
            writeStoredToken(null) // stale/expired token — forget it
          }
        }
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

  useEffect(() => {
    answersRef.current = answers
  }, [answers])
  useEffect(() => {
    stepRef.current = safeIndex
  }, [safeIndex])
  useEffect(() => {
    attemptRef.current = attemptId
  }, [attemptId])

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  const focusErrorSummary = () => requestAnimationFrame(() => errorSummaryRef.current?.focus())

  // ── Autosave (coalesced, no overlap, no out-of-order) ──────────────────────
  const saveDraft = useCallback(async () => {
    if (!schema) return
    if (savingRef.current) {
      pendingRef.current = true // a change arrived mid-save — save again after
      return
    }
    savingRef.current = true
    if (mountedRef.current) setSaveStatus("saving")
    const body = {
      answers: answersRef.current,
      current_step: stepRef.current,
      form_version: schema.version,
      client_submission_id: attemptRef.current,
    }
    try {
      if (!tokenRef.current) {
        const data = await draftFetch<DraftState>("/cso-mapping/drafts/", "POST", { body })
        tokenRef.current = data.resume_token ?? null
        writeStoredToken(tokenRef.current)
      } else {
        await draftFetch("/cso-mapping/drafts/current/", "PUT", {
          token: tokenRef.current,
          body,
        })
      }
      if (mountedRef.current) setSaveStatus("saved")
    } catch (err) {
      // A vanished draft (expired/deleted server-side) — drop the token so the
      // next save recreates it rather than looping on 404.
      if ((err as { status?: number })?.status === 404) {
        tokenRef.current = null
        writeStoredToken(null)
      }
      if (mountedRef.current) setSaveStatus("error")
    } finally {
      savingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void saveDraft()
      }
    }
  }, [schema])

  // Debounced trigger: autosave once consent is given and there is something to save.
  useEffect(() => {
    if (!schema || receipt || resumePrompt) return
    if (answers.consent !== "yes") return
    const handle = setTimeout(() => void saveDraft(), AUTOSAVE_DELAY)
    return () => clearTimeout(handle)
  }, [answers, safeIndex, schema, receipt, resumePrompt, saveDraft])

  const setAnswer = (name: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  // Bulk-set the captured location keys (lat/lng/accuracy/timestamp/method) and
  // clear any "location required" error.
  const setLocation = (values: Partial<Answers>) => {
    setAnswers((prev) => ({ ...prev, ...values }))
    setErrors((prev) => {
      if (!prev[LOCATION_ERROR_KEY]) return prev
      const next = { ...prev }
      delete next[LOCATION_ERROR_KEY]
      return next
    })
  }

  const jumpToField = (name: string) => {
    const el = document.getElementById(`cso-field-${name}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
    el?.querySelector<HTMLElement>("input, textarea, button")?.focus()
  }

  const goNext = () => {
    if (!currentStep) return
    const stepErrors = validateStep(currentStep, answers)
    // Enforce the required office location on the section that carries it.
    if (currentStep.name === LOCATION_SECTION && !hasValidLocation(answers)) {
      stepErrors[LOCATION_ERROR_KEY] = LOCATION_REQUIRED_MSG
    }
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

  const applyDraft = (draft: DraftState, token: string) => {
    tokenRef.current = token
    writeStoredToken(token)
    setAnswers(draft.answers ?? {})
    setStepIndex(draft.current_step ?? 0)
    if (draft.client_submission_id) setAttemptId(draft.client_submission_id)
    setResumePrompt(null)
    setSaveStatus("saved")
    setRestoredNote(true)
    scrollTop()
  }

  const resumeSavedDraft = async (token: string) => {
    try {
      const data = await draftFetch<DraftState>("/cso-mapping/drafts/current/", "GET", { token })
      applyDraft(data, token)
    } catch {
      writeStoredToken(null)
      setResumePrompt(null)
    }
  }

  const discardDraft = async () => {
    const token = tokenRef.current ?? resumePrompt?.token ?? readStoredToken()
    if (token) {
      try {
        await draftFetch("/cso-mapping/drafts/current/", "DELETE", { token })
      } catch {
        /* best effort */
      }
    }
    tokenRef.current = null
    writeStoredToken(null)
    setResumePrompt(null)
    setRestoredNote(false)
    setAnswers({})
    setStepIndex(0)
    setAttemptId(newAttemptId())
    setSaveStatus("idle")
    scrollTop()
  }

  const resetForAnother = () => {
    tokenRef.current = null
    writeStoredToken(null)
    setAnswers({})
    setErrors({})
    setSubmitError(null)
    setReceipt(null)
    setRestoredNote(false)
    setSaveStatus("idle")
    setStepIndex(0)
    setAttemptId(newAttemptId())
    scrollTop()
  }

  const submit = async () => {
    if (!schema) return
    // A submission must carry a valid captured location. Block early and send the
    // respondent back to the section that holds the capture control.
    if (!hasValidLocation(answers)) {
      setErrors((prev) => ({ ...prev, [LOCATION_ERROR_KEY]: LOCATION_REQUIRED_MSG }))
      const idx = steps.findIndex((s) => s.name === LOCATION_SECTION)
      if (idx >= 0) setStepIndex(idx)
      setSubmitError(
        "Please capture the CSO office location before submitting. Use the “Capture Current Location” button.",
      )
      scrollTop()
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    // Flush the latest state to the draft first so nothing is lost if submit fails.
    await saveDraft()
    const payload = {
      ...buildPayload(schema, answers),
      ...locationPayload(answers),
      client_submission_id: attemptId,
    }
    try {
      const data = tokenRef.current
        ? await draftFetch<Receipt>("/cso-mapping/drafts/current/submit/", "POST", {
            token: tokenRef.current,
            body: payload,
          })
        : (await api.post<Receipt>("/cso-mapping/submit/", payload)).data
      writeStoredToken(null)
      tokenRef.current = null
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

  if (resumePrompt) {
    return (
      <div ref={topRef}>
        <ResumePrompt
          updatedAt={resumePrompt.updatedAt}
          onResume={() => resumeSavedDraft(resumePrompt.token)}
          onDiscard={discardDraft}
        />
      </div>
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
    ? [
        ...currentStep.fields.filter((f) => errors[f.name]).map((f) => f.name),
        ...(currentStep.name === LOCATION_SECTION && errors[LOCATION_ERROR_KEY]
          ? [LOCATION_ERROR_KEY]
          : []),
      ]
    : []

  return (
    <div ref={topRef} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ProgressBar current={safeIndex + 1} total={totalSteps} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <SaveStatusPill status={saveStatus} />
        {tokenRef.current ? (
          <DiscardButton onDiscard={discardDraft} />
        ) : (
          <ResumeCodeEntry onResume={resumeSavedDraft} />
        )}
      </div>

      {restoredNote ? (
        <div role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          Your saved response was restored. You can continue where you left off.
        </div>
      ) : null}

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
                      {name === LOCATION_ERROR_KEY
                        ? "CSO office location"
                        : (fieldLabel(schema, name) ?? name)}
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
            {currentStep?.fields.map((field) => {
              if (!fieldIsActive(currentStep, field, answers)) return null
              const anchorLocation =
                currentStep.name === LOCATION_SECTION && field.name === LOCATION_ANCHOR_FIELD
              return (
                <Fragment key={field.name}>
                  <FieldControl
                    field={field}
                    value={answers[field.name] ?? ""}
                    error={errors[field.name]}
                    onChange={(v) => setAnswer(field.name, v)}
                    getComment={(opt) => {
                      const v = answers[commentKey(field.name, opt)]
                      return typeof v === "string" ? v : ""
                    }}
                    setComment={(opt, v) => setAnswer(commentKey(field.name, opt), v)}
                  />
                  {anchorLocation ? (
                    <LocationCapture
                      answers={answers}
                      error={errors[LOCATION_ERROR_KEY]}
                      onCapture={setLocation}
                    />
                  ) : null}
                </Fragment>
              )
            })}
            {/* If an edited schema removed the anchor field, still show the widget. */}
            {currentStep?.name === LOCATION_SECTION &&
            !currentStep.fields.some((f) => f.name === LOCATION_ANCHOR_FIELD) ? (
              <LocationCapture
                answers={answers}
                error={errors[LOCATION_ERROR_KEY]}
                onCapture={setLocation}
              />
            ) : null}

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

            {consentDeclined ? null : (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: ACCENT }}
              >
                {isLastFormStep && showReview ? "Review answers" : "Continue"}
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
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>
          Step {current} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: ACCENT }} />
      </div>
    </div>
  )
}

function SaveStatusPill({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { text: string; node: ReactNode } | null> = {
    idle: null,
    saving: { text: "Saving…", node: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> },
    saved: { text: "Draft saved", node: <Cloud className="h-3.5 w-3.5" aria-hidden="true" /> },
    error: { text: "Could not save draft", node: <CloudOff className="h-3.5 w-3.5" aria-hidden="true" /> },
  }
  const entry = map[status]
  return (
    <div role="status" aria-live="polite" className="min-h-[1.25rem] text-xs">
      {entry ? (
        <span
          className={`inline-flex items-center gap-1.5 ${
            status === "error" ? "text-red-600" : "text-slate-500"
          }`}
        >
          {entry.node}
          {entry.text}
        </span>
      ) : null}
    </div>
  )
}

function DiscardButton({ onDiscard }: { onDiscard: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm("Discard your saved response? This cannot be undone.")) onDiscard()
      }}
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-600"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      Discard saved response
    </button>
  )
}

function ResumeCodeEntry({ onResume }: { onResume: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-[#356a8d] hover:text-[#2b5872]"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Continue a saved response
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="cso-resume-code" className="sr-only">
        Resume code
      </label>
      <input
        id="cso-resume-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste your resume code"
        className="w-40 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => code.trim() && onResume(code.trim())}
        className="rounded bg-[#356a8d] px-2.5 py-1 text-xs font-semibold text-white"
      >
        Continue
      </button>
    </div>
  )
}

function ResumePrompt({
  updatedAt,
  onResume,
  onDiscard,
}: {
  updatedAt: string
  onResume: () => void
  onDiscard: () => void
}) {
  const when = new Date(updatedAt)
  const whenText = Number.isNaN(when.getTime()) ? "" : ` from ${when.toLocaleString()}`
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <RotateCcw className="h-9 w-9" style={{ color: ACCENT }} aria-hidden="true" />
        <h2 className="text-lg font-bold" style={{ color: ACCENT_DARK }}>
          Continue your saved response?
        </h2>
        <p className="max-w-md text-sm leading-6 text-slate-600">
          We found an unfinished response{whenText} on this device. You can continue where you left
          off, or start a new response.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onResume}
            className="inline-flex min-h-[44px] items-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: ACCENT }}
          >
            Continue saved response
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Start a new response? Your saved response will be discarded."))
                onDiscard()
            }}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Start a new response
          </button>
        </div>
      </div>
    </Card>
  )
}

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

      {hasValidLocation(answers) ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          CSO office location captured.
        </div>
      ) : null}

      <div className="mt-5 space-y-6">
        {steps.map((section, index) => {
          const entries = section.fields
            .filter((f) => f.type !== "note" && fieldIsActive(section, f, answers))
            .map((f) => ({
              field: f,
              value: displayValue(f, answers[f.name]),
              comments: answerComments(f, answers),
            }))
            .filter((e) => e.value !== "")
          if (entries.length === 0) return null
          return (
            <div key={section.name} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#2b5872]">{section.label ?? "Details"}</h3>
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
                {entries.map(({ field, value, comments }) => (
                  <div key={field.name}>
                    <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{value}</dd>
                    {comments.map((c) => (
                      <dd
                        key={c.label}
                        className="mt-0.5 whitespace-pre-wrap text-xs italic text-slate-500"
                      >
                        Comment ({c.label}): {c.text}
                      </dd>
                    ))}
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

/** Optional comment on ONE selected option: a reveal-on-demand textarea. */
function OptionComment({
  idBase,
  label,
  value,
  onChange,
}: {
  idBase: string
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(value.trim().length > 0)
  const textId = `${idBase}-comment`
  const on = label ? ` on “${label}”` : ""

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-[#356a8d] hover:text-[#2b5872] focus:outline-none focus-visible:underline"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        Add a comment{on} (optional)
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center justify-between">
        <label htmlFor={textId} className="text-xs font-medium text-slate-600">
          Comment{on} (optional)
        </label>
        <button
          type="button"
          onClick={() => {
            onChange("")
            setOpen(false)
          }}
          className="inline-flex items-center text-xs text-slate-400 hover:text-slate-600"
          aria-label="Remove comment"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <textarea
        id={textId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Add anything you'd like to explain…"
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#356a8d] focus:ring-2 focus:ring-[#356a8d]/30"
      />
    </div>
  )
}

type GeoStatus = "idle" | "capturing" | "success" | "error"

/** Respondent-safe message for a browser geolocation error (no technical codes). */
function geoErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1: // PERMISSION_DENIED
      return "Location access was denied. Please allow location access in your browser settings and try again."
    case 2: // POSITION_UNAVAILABLE
      return "Your current location could not be detected. Please switch on location services and try again."
    case 3: // TIMEOUT
      return "Location capture took too long. Please check your signal and try again."
    default:
      return "Location could not be captured. Please try again."
  }
}

/**
 * Office-location capture. One button uses the browser Geolocation API (high
 * accuracy) to record the device's current position. Coordinates are stored
 * internally (never shown to, or typed by, the respondent) — only a success
 * confirmation is displayed. Errors are mapped to plain guidance and the
 * respondent can always retry.
 */
function LocationCapture({
  answers,
  error,
  onCapture,
}: {
  answers: Answers
  error?: string
  onCapture: (values: Partial<Answers>) => void
}) {
  const captured = hasValidLocation(answers)
  const [status, setStatus] = useState<GeoStatus>(captured ? "success" : "idle")
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const capturing = status === "capturing"

  const capture = () => {
    setErrMsg(null)
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("error")
      setErrMsg(geoErrorMessage(2))
      return
    }
    setStatus("capturing")
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        onCapture({
          latitude: String(latitude),
          longitude: String(longitude),
          location_accuracy:
            accuracy != null && Number.isFinite(accuracy) ? String(accuracy) : "",
          location_captured_at: new Date().toISOString(),
          location_capture_method: "device_gps",
        })
        setStatus("success")
      },
      (err) => {
        setStatus("error")
        setErrMsg(geoErrorMessage(err?.code))
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  const showGeoError = status === "error" && !!errMsg
  const showRequiredError = !!error && !captured && !showGeoError

  return (
    <div id={`cso-field-${LOCATION_ERROR_KEY}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <MapPin className="h-4 w-4 text-[#356a8d]" aria-hidden="true" />
        CSO office location
        <span className="text-red-500">*</span>
      </span>
      <p className="mt-0.5 text-xs text-slate-500">
        Press the button below while you are at the organisation’s physical office.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          id="cso-capture-location-btn"
          type="button"
          onClick={capture}
          disabled={capturing}
          aria-describedby={`${LOCATION_ERROR_KEY}-status`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#356a8d]/50 focus-visible:ring-offset-2 disabled:opacity-70"
          style={{ backgroundColor: status === "success" ? ACCENT_DARK : ACCENT }}
        >
          {capturing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Navigation className="h-4 w-4" aria-hidden="true" />
          )}
          {capturing
            ? "Capturing location…"
            : status === "success"
              ? "Recapture Location"
              : "Capture Current Location"}
        </button>

        {status === "success" ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Location captured successfully
          </span>
        ) : null}
      </div>

      {/* Accessible live region — announces progress/success independent of colour. */}
      <div id={`${LOCATION_ERROR_KEY}-status`} role="status" aria-live="polite" className="sr-only">
        {capturing
          ? "Capturing location, please wait."
          : status === "success"
            ? "Location captured successfully."
            : ""}
      </div>

      {showGeoError ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {errMsg}
        </p>
      ) : null}
      {showRequiredError ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

function FieldControl({
  field,
  value,
  error,
  onChange,
  getComment,
  setComment,
}: {
  field: Field
  value: AnswerValue
  error?: string
  onChange: (value: AnswerValue) => void
  getComment?: (option: string) => string
  setComment?: (option: string, value: string) => void
}) {
  if (field.type === "note") {
    if (field.name === "thank_you") return null
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
  // Scalar view of the value for text / single-choice; list view for multi-select.
  const strValue = typeof value === "string" ? value : ""
  const chosen = asList(value)
  // Per-selected-option comment controls (select questions only).
  const commentsEnabled = supportsComment(field) && !!getComment && !!setComment
  const optionLabel = (name: string) =>
    field.choices?.find((c) => c.name === name)?.label ?? name

  const errorNode = error ? (
    <p id={errorId} className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {error}
    </p>
  ) : null

  if (field.type === "select_multiple") {
    const choices = field.choices ?? []
    const toggle = (name: string) =>
      onChange(chosen.includes(name) ? chosen.filter((v) => v !== name) : [...chosen, name])
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
        ) : (
          <p className="mt-0.5 text-xs text-slate-500">Select all that apply.</p>
        )}
        <div className="mt-2 flex flex-col gap-2">
          {choices.map((choice) => {
            const isSelected = chosen.includes(choice.name)
            return (
              <div key={choice.name}>
                <label
                  className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                    isSelected
                      ? "border-[#356a8d] bg-[#eef4f8] text-[#2b5872]"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    name={field.name}
                    value={choice.name}
                    checked={isSelected}
                    onChange={() => toggle(choice.name)}
                    className="h-4 w-4 accent-[#356a8d]"
                  />
                  {choice.label}
                </label>
                {isSelected && commentsEnabled ? (
                  <div className="ml-6 mt-1">
                    <OptionComment
                      idBase={`${field.name}-${choice.name}`}
                      value={getComment!(choice.name)}
                      onChange={(v) => setComment!(choice.name, v)}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        {errorNode}
      </fieldset>
    )
  }

  if (field.type === "select_one") {
    const choices = field.choices ?? []
    // Long lists (e.g. the district selection) render as a dropdown, not radios.
    if (choices.length > DROPDOWN_CHOICE_THRESHOLD) {
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
            <select
              id={field.name}
              value={strValue}
              onChange={(e) => onChange(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-[#356a8d] focus:ring-2 focus:ring-[#356a8d]/30"
            >
              <option value="">Please select…</option>
              {choices.map((choice) => (
                <option key={choice.name} value={choice.name}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          {errorNode}
          {commentsEnabled && strValue ? (
            <div className="mt-2">
              <OptionComment
                idBase={`${field.name}-${strValue}`}
                label={optionLabel(strValue)}
                value={getComment!(strValue)}
                onChange={(v) => setComment!(strValue, v)}
              />
            </div>
          ) : null}
        </div>
      )
    }
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
            const selected = strValue === choice.name
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
        {commentsEnabled && strValue ? (
          <div className="mt-2">
            <OptionComment
              idBase={`${field.name}-${strValue}`}
              label={optionLabel(strValue)}
              value={getComment!(strValue)}
              onChange={(v) => setComment!(strValue, v)}
            />
          </div>
        ) : null}
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
            value={strValue}
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
            value={strValue}
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
