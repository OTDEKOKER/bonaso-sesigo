"use client"

import { useAuth } from "@/lib/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChangePasswordForm } from "@/components/auth/change-password-form"

/**
 * Voluntary change-password dialog (dismissible). Opened proactively from the
 * expiry-warning banner. On success it refreshes the user (which resets
 * password_status), toasts, and closes.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { refreshUser } = useAuth()
  const { toast } = useToast()

  const handleSuccess = async () => {
    await refreshUser()
    toast({ title: "Password changed", description: "Your new password is now active." })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">Change your password</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            Enter your current password and choose a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-1">
          <ChangePasswordForm onSuccess={handleSuccess} submitLabel="Change password" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
