"use client"

import { useState } from "react"
import { KeyRound } from "lucide-react"
import { useAuth } from "@/lib/contexts/auth-context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChangePasswordForm } from "@/components/auth/change-password-form"

/**
 * Mandatory password-expiry gate (DPA policy).
 *
 * Rendered IN PLACE OF the whole dashboard shell (see (dashboard)/layout.tsx)
 * whenever /api/users/me reports `password_status.expired`, exactly like the
 * confidentiality gate — so no protected page mounts until the password is
 * changed. Non-dismissible; the only exits are:
 *   • Set new password → server resets the expiry clock and refreshUser() clears
 *     `expired`, unmounting the gate.
 *   • Sign out → for a user who no longer remembers their current password; they
 *     can then use "Request a password reset" on the login screen (admin approves).
 */
export function PasswordExpiryGate() {
  const { logout, refreshUser } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await logout()
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <DialogHeader className="items-center text-center">
          <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <KeyRound className="h-6 w-6" />
          </span>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Your password has expired
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            As required by our data-protection policy, passwords must be changed every
            90 days. Please set a new password to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <ChangePasswordForm onSuccess={refreshUser} />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-3 w-full text-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            I don&apos;t remember my current password — sign out
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
