"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AlertCircle, ArrowLeft, Loader2, Printer } from "lucide-react"

import { api } from "@/lib/api"
import type { Field, FormSchema, Section } from "@/components/cso-mapping/schema"

const ACCENT = "#356a8d"
const ACCENT_DARK = "#2b5872"

// The live form captures the office location via device GPS, not as a schema
// field. On a paper copy we leave a write-in line beneath the physical address
// so it can be recorded by hand and captured on a device later.
const LOCATION_ANCHOR_FIELD = "physical_address"

/** A short line to write a single value on. */
function WriteLine() {
  return <div className="mt-2 h-8 border-b border-slate-400" aria-hidden="true" />
}

/** A boxed area with a few ruled lines for longer answers. */
function WriteBox() {
  return (
    <div className="mt-2 space-y-5 rounded border border-slate-300 p-2" aria-hidden="true">
      <div className="border-b border-slate-300" />
      <div className="border-b border-slate-300" />
      <div className="border-b border-slate-300" />
    </div>
  )
}

/** An empty tick box for one choice. */
function ChoiceBox({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] border border-slate-500"
        aria-hidden="true"
      />
      <span>{label}</span>
    </li>
  )
}

/** One question (or note) rendered for filling in by hand. */
function PrintField({ field, number }: { field: Field; number: number | null }) {
  if (field.type === "note") {
    // The live form hides the post-submission thank-you note; a blank copy has
    // nothing to thank for, so skip it here too.
    if (field.name === "thank_you") return null
    return (
      <p className="text-sm italic leading-6 text-slate-600 print:text-slate-800">{field.label}</p>
    )
  }

  const isSelect = field.type === "select_one" || field.type === "select_multiple"
  const choices = field.choices ?? []

  return (
    <div className="break-inside-avoid">
      <p className="text-sm font-semibold leading-snug text-slate-900">
        {number != null ? <span className="mr-1 text-slate-500">{number}.</span> : null}
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-500 print:text-slate-900">*</span> : null}
      </p>
      {field.hint ? <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p> : null}
      {field.relevant ? (
        <p className="mt-0.5 text-xs italic text-slate-500">Answer only if applicable.</p>
      ) : null}

      {isSelect ? (
        <>
          {field.type === "select_multiple" ? (
            <p className="mt-1 text-xs text-slate-500">Select all that apply.</p>
          ) : null}
          <ul className="mt-2 space-y-1.5 text-sm text-slate-800">
            {choices.map((c) => (
              <ChoiceBox key={c.name} label={c.label} />
            ))}
          </ul>
        </>
      ) : field.multiline ? (
        <WriteBox />
      ) : (
        <WriteLine />
      )}

      {field.name === LOCATION_ANCHOR_FIELD ? (
        <div className="mt-4 break-inside-avoid">
          <p className="text-sm font-semibold leading-snug text-slate-900">
            Office GPS location
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            To be captured on a device at the office. If recording by hand, note the coordinates
            below.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-slate-500">Latitude</span>
              <div className="mt-1 h-8 border-b border-slate-400" aria-hidden="true" />
            </div>
            <div>
              <span className="text-xs text-slate-500">Longitude</span>
              <div className="mt-1 h-8 border-b border-slate-400" aria-hidden="true" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A print-friendly, blank copy of the whole CSO Mapping questionnaire.
 *
 * Every section and question is laid out for completion by hand (paper copy for
 * offline data collection). Skip-logic is intentionally ignored so no question
 * is hidden — conditional questions are flagged "Answer only if applicable".
 */
export function PrintableQuestionnaire() {
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let active = true
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

  // A running question number across the whole form (notes are not numbered).
  const numbering = useMemo(() => {
    const map = new Map<string, number>()
    if (!schema) return map
    let n = 0
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (field.type !== "note") map.set(field.name, ++n)
      }
    }
    return map
  }, [schema])

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-700">The questionnaire could not be loaded.</p>
        <p className="max-w-sm text-xs leading-5 text-slate-500">
          Please check your connection and refresh the page.
        </p>
        <Link
          href="/cso-mapping"
          className="mt-2 text-sm font-medium text-[#356a8d] underline underline-offset-2"
        >
          Return to introduction
        </Link>
      </div>
    )
  }

  if (!schema) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} aria-hidden="true" />
        <p className="text-sm font-medium text-slate-700">Preparing a printable copy…</p>
      </div>
    )
  }

  const sections: Section[] = schema.sections.filter((s) =>
    s.fields.some((f) => f.type !== "note" || f.name !== "thank_you"),
  )

  return (
    <div className="text-slate-800">
      {/* Screen-only toolbar — hidden when printing. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/cso-mapping"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: ACCENT }}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print
        </button>
      </div>

      <p className="mb-6 rounded-lg border border-[#d6e3ec] bg-[#eef4f8] px-4 py-3 text-xs leading-5 text-slate-600 print:hidden">
        This is a blank copy of the questionnaire for completion by hand. Use the Print button above,
        then choose your printer — or “Save as PDF” to keep a digital copy. Answers written on paper
        are not submitted automatically; they must be entered into the online form.
      </p>

      {/* Print header */}
      <header className="mb-6 border-b border-slate-300 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#356a8d]">
              BONASO · Botswana
            </p>
            <h1 className="mt-1 text-xl font-bold leading-tight" style={{ color: ACCENT_DARK }}>
              {schema.title || "Botswana Health Service CSO Mapping & Capacity Assessment"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Image
              src="/nahpa-logo.png"
              alt="NAHPA"
              width={865}
              height={433}
              className="h-8 w-auto"
            />
            <Image
              src="/bonaso-logo.png"
              alt="BONASO"
              width={284}
              height={372}
              className="h-11 w-auto"
            />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <span className="text-xs text-slate-500">Date completed</span>
            <div className="mt-1 h-7 border-b border-slate-400" aria-hidden="true" />
          </div>
          <div>
            <span className="text-xs text-slate-500">Completed by</span>
            <div className="mt-1 h-7 border-b border-slate-400" aria-hidden="true" />
          </div>
        </div>
      </header>

      <div className="space-y-8">
        {sections.map((section, i) => (
          <section key={section.name} className="break-inside-avoid">
            {section.label ? (
              <h2 className="mb-3 border-b border-slate-200 pb-1.5 text-base font-bold text-[#2b5872]">
                <span className="mr-1.5 text-slate-400">{i + 1}.</span>
                {section.label}
              </h2>
            ) : null}
            <div className="space-y-5">
              {section.fields.map((field) => (
                <Fragment key={field.name}>
                  <PrintField field={field} number={numbering.get(field.name) ?? null} />
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-slate-300 pt-4 text-center text-[11px] text-slate-400">
        © 2026 Sesigo Data Portal · Powered by BONASO — blank questionnaire copy
      </p>
    </div>
  )
}
