"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FlagCard, type FlagData } from "./FlagCard"
import { Flag } from "lucide-react"
import { ComponentLoading } from "@/components/reuseables/loading/ComponentLoading"

export interface FlagDetailModalProps {
  isOpen: boolean
  onClose: () => void
  flags: FlagData[]
  isLoading?: boolean
  onResolve?: (id: number, notes: string) => Promise<void>
  onDismiss?: (id: number, notes: string) => Promise<void>
  title?: string
}

export function FlagDetailModal({
  isOpen,
  onClose,
  flags,
  isLoading = false,
  onResolve,
  onDismiss,
  title = "Flags",
}: FlagDetailModalProps) {
  const pendingFlags = flags.filter((f) => f.status === "pending")
  const resolvedFlags = flags.filter((f) => f.status !== "pending")

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-destructive" />
            {title}
            {pendingFlags.length > 0 && (
              <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">
                {pendingFlags.length} pending
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <ComponentLoading size="lg" />
            </div>
          ) : flags.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No flags found
            </div>
          ) : (
            <div className="space-y-6">
              {pendingFlags.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Pending ({pendingFlags.length})
                  </h3>
                  {pendingFlags.map((flag) => (
                    <FlagCard
                      key={flag.id}
                      flag={flag}
                      onResolve={onResolve}
                      onDismiss={onDismiss}
                    />
                  ))}
                </div>
              )}

              {resolvedFlags.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Resolved ({resolvedFlags.length})
                  </h3>
                  {resolvedFlags.map((flag) => (
                    <FlagCard
                      key={flag.id}
                      flag={flag}
                      expandable={true}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FlagDetailModal
