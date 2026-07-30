"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

interface QuestionnaireFrameProps {
  /** Embed URL for the questionnaire. */
  embedUrl: string
  /** Accessible title for the embedded form. */
  title: string
  /** CSS height for the frame (viewport-relative). Defaults to a full-page form. */
  heightCss?: string
}

/**
 * Renders the questionnaire inside a responsive iframe, fully SESIGO-branded.
 *
 * - Shows a loading state until the form's `onLoad` fires.
 * - After a delay, surfaces a neutral "refresh / contact BONASO" hint in case
 *   the form is slow to appear. No third-party name or URL is shown to the
 *   respondent, so the experience stays on sesigo.org.bw throughout.
 *
 * Responses submit straight to the survey backend; nothing is stored in SESIGO.
 */
export function QuestionnaireFrame({
  embedUrl,
  title,
  heightCss = "calc(100dvh - 8rem)",
}: QuestionnaireFrameProps) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (loaded) return
    const timer = setTimeout(() => setSlow(true), 15000)
    return () => clearTimeout(timer)
  }, [loaded])

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {!loaded ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center text-gray-600"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-8 w-8 animate-spin text-[#356a8d]" aria-hidden="true" />
            <p className="text-sm font-medium text-gray-700">Loading the questionnaire…</p>
            {slow ? (
              <p className="max-w-sm text-xs leading-5 text-gray-500">
                This is taking longer than usual. Please check your connection and refresh the page.
                If the problem continues, contact BONASO for assistance.
              </p>
            ) : null}
          </div>
        ) : null}

        <iframe
          src={embedUrl}
          title={title}
          className="block w-full border-0"
          style={{ height: heightCss, minHeight: 640 }}
          loading="lazy"
          allow="geolocation; camera; microphone"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />
      </div>

      <p className="mt-3 text-center text-xs text-slate-500">
        If the questionnaire does not appear, please refresh the page.
      </p>
    </div>
  )
}
