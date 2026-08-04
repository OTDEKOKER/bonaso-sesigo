import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { NativeQuestionnaire } from "@/components/cso-mapping/native-questionnaire"

export const metadata: Metadata = {
  title: "Questionnaire — Botswana Health Service CSO Mapping & Capacity Assessment",
  description:
    "Complete the Botswana Health Service Civil Society Organisation Mapping and Capacity Assessment questionnaire.",
  robots: { index: false, follow: false },
}

/**
 * The CSO Mapping questionnaire — a native, Sesigo-hosted form. Responses are
 * stored in Sesigo's own database (no third-party form host), so personal data
 * stays on in-country infrastructure (Data Protection Act, 2018).
 */
export default function CsoMappingQuestionnairePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#f4f6f8] text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-2 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              href="/cso-mapping"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
            <div className="flex flex-col leading-none">
              <span className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
                Sesigo
              </span>
              <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.2em] text-slate-400">
                Data Portal
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <Image
              src="/nahpa-logo.png"
              alt="NAHPA — National AIDS and Health Promotion Agency, Botswana"
              width={865}
              height={433}
              className="h-7 w-auto sm:h-8"
            />
            <Image
              src="/bonaso-logo.png"
              alt="BONASO — Botswana Network of AIDS Services Organisations"
              width={284}
              height={372}
              className="h-10 w-auto sm:h-12"
            />
          </div>
        </div>
      </header>

      <section
        className="mx-auto w-full max-w-3xl flex-1 px-2 py-5 sm:px-4"
        aria-label="Botswana Health Service CSO Mapping and Capacity Assessment questionnaire"
      >
        <NativeQuestionnaire />
      </section>
    </main>
  )
}
