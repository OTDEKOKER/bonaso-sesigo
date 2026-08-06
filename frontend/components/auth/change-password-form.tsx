"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { authService } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Shared self-service change-password form. Used both by the mandatory
 * PasswordExpiryGate (expired password) and the voluntary ChangePasswordDialog
 * (proactive change from the expiry-warning banner). Verifies the current
 * password server-side and resets the DPA expiry clock on success.
 */
export function ChangePasswordForm({
  onSuccess,
  submitLabel = "Set new password",
}: {
  onSuccess: () => void | Promise<void>
  submitLabel?: string
}) {
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.")
      return
    }
    if (newPassword === oldPassword) {
      setError("New password must be different from your current one.")
      return
    }
    setSubmitting(true)
    try {
      await authService.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
          {error}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="pw-old" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Current password
        </Label>
        <Input
          id="pw-old"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-new" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          New password
        </Label>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Confirm new password
        </Label>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          disabled={submitting}
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {submitLabel}
      </Button>
    </form>
  )
}
