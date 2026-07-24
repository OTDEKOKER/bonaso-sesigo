"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { authService } from "@/lib/api"
import { useAuth } from "@/lib/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * Mandatory confidentiality gate.
 *
 * Rendered IN PLACE OF the whole dashboard shell (see (dashboard)/layout.tsx) so
 * no protected page mounts and no data fetches fire whenever /api/users/me
 * reports `confidentiality.needs_acknowledgement`. The modal is non-dismissible —
 * there is no ✕ and Escape / outside-click do nothing — so the only exits are:
 *   • Accept  → record acceptance server-side, then refresh the user so the gate
 *               unmounts and the app renders.
 *   • Sign out → secure logout (clears tokens + cached user, broadcasts cross-tab,
 *               redirects to /login) with a flag /login reads to explain why.
 */
export function ConfidentialityGate() {
  const { logout, refreshUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  // The user must tick the acknowledgement box before OK is enabled.
  const [agreed, setAgreed] = useState(false)

  const handleAccept = async () => {
    if (!agreed) return
    setSubmitting(true)
    try {
      await authService.acknowledgeConfidentiality()
      await refreshUser() // clears needs_acknowledgement → this gate unmounts
    } catch {
      // Leave the gate up so the user can retry; nothing was recorded.
      setSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    setSubmitting(true)
    try {
      // Read on /login to explain why the user was signed out.
      sessionStorage.setItem("confidentiality_signout", "1")
    } catch {
      /* storage unavailable — sign out regardless */
    }
    await logout()
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="top-1/2 w-[calc(100vw-1rem)] max-w-[76rem] overflow-hidden border-0 bg-transparent p-0 shadow-none sm:w-[min(calc(100vw-2rem),76rem)]"
      >
        <div className="w-full rounded-none border-[10px] border-border bg-card px-6 py-5 text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.18)] sm:border-[12px] sm:px-12 sm:py-7 md:px-16 md:py-8">
          <DialogHeader className="mx-auto flex w-full max-w-[68rem] items-center space-y-3 text-center sm:space-y-4">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Welcome to the Sesigo Data Portal
            </DialogTitle>
            <DialogDescription asChild className="text-muted-foreground">
              <div className="mx-auto flex w-full max-w-[62rem] flex-col items-center space-y-5 text-foreground">
                <p className="w-full text-justify text-sm leading-6 [text-wrap:pretty] sm:text-base">
                  Welcome to the Sesigo Data Portal, powered by BONASO. Please note that any information you see in this portal
                  is confidential, and may not be shared or distributed to anyone outside of your organization.
                  <strong className="font-bold text-foreground">
                    {" "}Any violations of client confidentiality is against the law and is punishable by fines
                    and/or jail time.
                  </strong>{" "}
                  By entering this portal, you agree to maintain confidentiality of all data you see here and
                  agree that you will not misuse any information here.
                </p>
                <p className="w-full text-justify text-sm leading-6 [text-wrap:pretty] sm:text-base">
                  Thank you for all the important work you do in the fight for a healthier Botswana!
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* Deliberate acknowledgement: the box must be ticked before OK enables. */}
          <div className="mx-auto mt-6 flex w-full max-w-[40rem] items-start gap-3">
            <Checkbox
              id="confidentiality-agree"
              checked={agreed}
              onCheckedChange={(value) => setAgreed(value === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <label
              htmlFor="confidentiality-agree"
              className="cursor-pointer text-sm font-medium leading-5 text-foreground"
            >
              I have read, understand, and agree.
            </label>
          </div>

          <div className="mx-auto mt-5 flex w-full max-w-[40rem] flex-col gap-3 sm:flex-row">
            <Button
              onClick={handleAccept}
              disabled={submitting || !agreed}
              className="min-h-11 w-full whitespace-normal rounded-none bg-primary px-5 py-2.5 text-center text-sm font-semibold leading-5 text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-50 sm:flex-1 sm:min-w-0"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              OK
            </Button>
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={submitting}
              className="min-h-11 w-full whitespace-normal rounded-none px-5 py-2.5 text-center text-sm font-semibold leading-5 sm:flex-1 sm:min-w-0"
            >
              I do not understand — Sign me out.
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
