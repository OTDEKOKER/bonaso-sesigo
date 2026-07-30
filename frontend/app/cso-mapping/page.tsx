import type { Metadata } from "next"
import { ShieldCheck } from "lucide-react"

import { QuestionnaireFrame } from "@/components/cso-mapping/questionnaire-frame"

// Standard web-form URL for the survey, embedded so the questionnaire behaves
// exactly as it does natively (form navigation, language, submit, geolocation).
// Kept in one place so it can be updated if the form is republished under a new
// id. The page around it stays SESIGO-branded on sesigo.org.bw.
const QUESTIONNAIRE_EMBED_URL = "https://ee.kobotoolbox.org/x/bV765QEZ"

// Existing in-app support contact (see components/shared/maintenance-screen.tsx).
// TODO(management): confirm this is the correct public support address for the
// CSO Mapping questionnaire before wide distribution.
const SUPPORT_EMAIL = "info@bonaso.org"

export const metadata: Metadata = {
  title: "Health Service CSO Mapping & Capacity Assessment — Sesigo",
  description:
    "BONASO Health Service Civil Society Organisation Mapping and Capacity Assessment. Help identify health-service CSOs operating across Botswana.",
  // Public survey landing page — keep it out of search indexes.
  robots: { index: false, follow: false },
}

export default function CsoMappingPage() {
  return (
    <main className="min-h-[100dvh] bg-[#0b2318] text-white">
      <header className="border-b border-white/10 bg-[#0e1f16]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tracking-tight">Sesigo</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/45">
              Data Portal
            </span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">
            Powered by BONASO
          </span>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-4 pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
          BONASO · Botswana
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          Health Service Civil Society Organisation Mapping and Capacity Assessment
        </h1>
        <p className="mt-4 text-sm leading-7 text-white/80 sm:text-base">
          This questionnaire is part of the BONASO Health Service Civil Society Organisation Mapping
          and Capacity Assessment. It is being conducted to identify health-service CSOs operating
          across Botswana, understand the services they provide, assess their organisational and
          technical capacities, and identify gaps affecting effective participation in Primary Health
          Care Revitalisation. The information collected will support improved coordination, capacity
          strengthening, service planning and the development of a national Health Service CSO
          Directory.
        </p>

        <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Confidentiality
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-white/75">
            Participation is voluntary. Information collected through this questionnaire will be used
            for the CSO Mapping and Capacity Assessment. Access to raw information will be restricted
            to authorised project personnel.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-2 pb-4 sm:px-4" aria-label="Questionnaire">
        <QuestionnaireFrame
          embedUrl={QUESTIONNAIRE_EMBED_URL}
          title="BONASO Health Service CSO Mapping and Capacity Assessment"
        />
      </section>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-10">
        <p className="text-sm leading-6 text-white/70">
          <span className="font-semibold text-white/85">Need help?</span> If you experience any
          technical difficulties completing this questionnaire, please contact BONASO at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-4 text-[11px] text-white/40">© 2026 Sesigo Data Portal. Powered by BONASO.</p>
      </footer>
    </main>
  )
}
