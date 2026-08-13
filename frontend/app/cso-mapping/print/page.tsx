import type { Metadata } from "next"

import { PrintableQuestionnaire } from "@/components/cso-mapping/printable-questionnaire"

export const metadata: Metadata = {
  title: "Print questionnaire — Botswana Health Service CSO Mapping & Capacity Assessment",
  description:
    "A printable blank copy of the Botswana Health Service CSO Mapping and Capacity Assessment questionnaire.",
  robots: { index: false, follow: false },
}

/**
 * A print-friendly, blank copy of the CSO Mapping questionnaire. All questions
 * are laid out for completion by hand (a paper copy for offline data
 * collection); answers still have to be entered into the online form.
 */
export default function CsoMappingPrintPage() {
  return (
    <main className="min-h-[100dvh] bg-[#f4f6f8] text-slate-700 print:bg-white">
      <section className="mx-auto w-full max-w-3xl px-4 py-8 print:px-0 print:py-0">
        <PrintableQuestionnaire />
      </section>
    </main>
  )
}
