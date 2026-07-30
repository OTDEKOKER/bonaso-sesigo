import type { Metadata } from "next"
import Image from "next/image"
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
    <main className="flex min-h-[100dvh] flex-col bg-[#f4f6f8] text-slate-700">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link
          href="/cso-mapping"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <Image
            src="/bonaso-logo.png"
            alt="BONASO — Botswana Network of AIDS Services Organisations"
            width={284}
            height={372}
            className="h-8 w-auto sm:h-9"
          />
          <Image
            src="/nahpa-logo.png"
            alt="NAHPA — National AIDS and Health Promotion Agency, Botswana"
            width={865}
            height={433}
            className="h-6 w-auto sm:h-7"
          />
        </div>
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
