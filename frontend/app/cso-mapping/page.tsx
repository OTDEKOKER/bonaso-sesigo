import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, ShieldCheck } from "lucide-react"

// Existing in-app support contact (see components/shared/maintenance-screen.tsx).
// TODO(management): confirm this is the correct public support address for the
// CSO Mapping questionnaire before wide distribution.
const SUPPORT_EMAIL = "info@bonaso.org"
// BONASO support phone (Botswana). Rendered with a tel: link (spaces stripped).
const SUPPORT_PHONE = "+267 317 0582"

export const metadata: Metadata = {
  title: "Botswana Health Service CSO Mapping & Capacity Assessment — Sesigo",
  description:
    "Botswana Health Service CSO Mapping and Capacity Assessment. Help identify health-service CSOs operating across Botswana.",
  // Public survey landing page — keep it out of search indexes.
  robots: { index: false, follow: false },
}

export default function CsoMappingIntroPage() {
  return (
    <main className="min-h-[100dvh] bg-[#f4f6f8] text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-col leading-none">
            <span className="text-2xl font-extrabold tracking-tight text-slate-900">Sesigo</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.25em] text-slate-400">
              Data Portal
            </span>
          </div>
          <div className="flex items-center gap-4 sm:gap-5">
            <Image
              src="/nahpa-logo.png"
              alt="NAHPA — National AIDS and Health Promotion Agency, Botswana"
              width={865}
              height={433}
              priority
              className="h-9 w-auto sm:h-10"
            />
            <Image
              src="/bonaso-logo.png"
              alt="BONASO — Botswana Network of AIDS Services Organisations"
              width={284}
              height={372}
              priority
              className="h-14 w-auto sm:h-16"
            />
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-12 pt-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#356a8d]">
            BONASO · Botswana
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-[#2b5872] sm:text-3xl">
            Botswana Health Service CSO Mapping &amp; Capacity Assessment
          </h1>
          <p className="mt-4 text-justify text-sm leading-7 text-slate-600 sm:text-base">
            This questionnaire is part of the Botswana Health Service CSO Mapping and Capacity
            Assessment. It is being conducted to identify health-service CSOs
            operating across Botswana, understand the services they provide, assess their
            organisational and technical capacities, and identify gaps affecting effective
            participation in Primary Health Care Revitalisation. The information collected will
            support improved coordination, capacity strengthening, service planning and the
            development of a national Health Service CSO Directory.
          </p>

          <div className="mt-5 rounded-xl border border-[#d6e3ec] bg-[#eef4f8] px-4 py-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#2b5872]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Participation, Consent and Confidentiality
            </h2>
            <div className="mt-1.5 space-y-2 text-justify text-sm leading-6 text-slate-600">
              <p>
                Participation is voluntary. Information collected will be used for the Botswana
                Health Service CSO Mapping and Capacity Assessment, including coordination, capacity
                strengthening, service planning and development of a national Health Service CSO
                Directory.
              </p>
              <p>
                Selected organisational information may be included in the directory. Personal
                contact information and raw questionnaire responses will be accessible only to
                authorised project personnel and will not be published without approval.
              </p>
              <p>
                You may decline to participate or stop before submitting the questionnaire. For
                questions or requests concerning your information, contact BONASO at{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="font-medium text-[#356a8d] underline underline-offset-2 hover:text-[#2b5872]"
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                or{" "}
                <a
                  href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`}
                  className="font-medium text-[#356a8d] underline underline-offset-2 hover:text-[#2b5872]"
                >
                  {SUPPORT_PHONE}
                </a>
                .
              </p>
            </div>
          </div>

          <div className="mt-8">
            <Link
              href="/cso-mapping/questionnaire"
              className="inline-flex items-center gap-2 rounded-lg bg-[#356a8d] px-6 py-3 text-base font-semibold tracking-tight text-white transition-colors hover:bg-[#2b5872] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#356a8d]"
            >
              Start Questionnaire
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
            <p className="mt-3 text-xs text-slate-400">The questionnaire opens on the next page.</p>
          </div>
        </div>

        <div className="mt-8">
          <p className="text-sm leading-6 text-slate-500">
            <span className="font-semibold text-slate-700">Need help?</span> If you experience any
            technical difficulties completing this questionnaire, please contact BONASO at{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-[#356a8d] underline underline-offset-2 hover:text-[#2b5872]"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            or{" "}
            <a
              href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`}
              className="font-medium text-[#356a8d] underline underline-offset-2 hover:text-[#2b5872]"
            >
              {SUPPORT_PHONE}
            </a>
            .
          </p>
          <p className="mt-4 text-[11px] text-slate-400">
            © 2026 Sesigo Data Portal. Powered by BONASO.
          </p>
        </div>
      </section>
    </main>
  )
}
