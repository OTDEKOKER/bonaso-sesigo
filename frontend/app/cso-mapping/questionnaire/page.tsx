import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { QuestionnaireFrame } from "@/components/cso-mapping/questionnaire-frame"

// Web-form URL for the survey, embedded so the questionnaire behaves exactly as
// it does natively (form navigation, language, submit, geolocation). Kept in one
// place so it can be updated if the form is republished under a new id. The page
// around it stays SESIGO-branded on sesigo.org.bw.
const QUESTIONNAIRE_EMBED_URL = "https://ee.kobotoolbox.org/x/bV765QEZ"

export const metadata: Metadata = {
  title: "Questionnaire — Health Service CSO Mapping & Capacity Assessment",
  description:
    "Complete the BONASO Health Service Civil Society Organisation Mapping and Capacity Assessment questionnaire.",
  robots: { index: false, follow: false },
}

export default function CsoMappingQuestionnairePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#0b2318] text-white">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-[#0e1f16] px-4 py-3">
        <Link
          href="/cso-mapping"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-white/70 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">Sesigo</span>
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.25em] text-white/45 sm:inline">
            Data Portal
          </span>
        </div>
        <span className="hidden text-[10px] font-medium uppercase tracking-wide text-white/40 sm:inline">
          Powered by BONASO
        </span>
      </header>

      <section
        className="mx-auto w-full max-w-5xl flex-1 px-2 py-3 sm:px-4"
        aria-label="Health Service CSO Mapping and Capacity Assessment questionnaire"
      >
        <QuestionnaireFrame
          embedUrl={QUESTIONNAIRE_EMBED_URL}
          title="BONASO Health Service CSO Mapping and Capacity Assessment"
          heightCss="calc(100dvh - 5rem)"
        />
      </section>
    </main>
  )
}
