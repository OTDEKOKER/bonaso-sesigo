"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"

interface QuestionnaireFrameProps {
  /** Iframe-optimised Enketo embed URL (Kobo "embeddable web form"). */
  embedUrl: string
  /** Standard Enketo URL used for the "open directly" fallback link. */
  directUrl: string
  /** Accessible title for the embedded form. */
  title: string
}

/**
 * Renders the KoboToolbox (Enketo) questionnaire inside a responsive iframe.
 *
 * - Shows a loading state until the form's `onLoad` fires.
 * - After a delay, surfaces a prominent "open directly" hint in case the embed
 *   is slow or blocked by the respondent's network/browser.
 * - Always keeps a subtle direct-link fallback below the frame.
 *
 * Responses submit straight to KoboToolbox; nothing is stored in SESIGO.
 */
export function QuestionnaireFrame({ embedUrl, directUrl, title }: QuestionnaireFrameProps) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (loaded) return
    const timer = setTimeout(() => setSlow(true), 15000)
    return () => clearTimeout(timer)
  }, [loaded])

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/40 ring-1 ring-white/10">
        {!loaded ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center text-gray-600"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-700">Loading the questionnaire…</p>
            {slow ? (
              <p className="max-w-sm text-xs leading-5 text-gray-500">
                This is taking longer than usual. If the form does not appear, you can{" "}
                <a
                  href={directUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-emerald-600 underline underline-offset-2"
                >
                  open the questionnaire directly
                </a>
                .
              </p>
            ) : null}
          </div>
        ) : null}

        <iframe
          src={embedUrl}
          title={title}
          className="block w-full border-0"
          style={{ height: "calc(100dvh - 8rem)", minHeight: 640 }}
          loading="lazy"
          allow="geolocation; camera; microphone"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />
      </div>

      <p className="mt-3 text-center text-xs text-white/55">
        Having trouble viewing the form?{" "}
        <a
          href={directUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          Open the questionnaire directly
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  )
}
