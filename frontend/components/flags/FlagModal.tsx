"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { RadioButtons } from "@/components/reuseables/inputs/RadioButtons"
import { Select } from "@/components/reuseables/inputs/Select"
import { ButtonLoading } from "@/components/reuseables/loading/ButtonLoading"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Flag, AlertTriangle } from "lucide-react"

export interface FlagModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    reason: string
    description: string
    severity: "low" | "medium" | "high"
  }) => Promise<void>
  contentType?: string
  objectId?: number
  title?: string
  reasonOptions?: { value: string; label: string }[]
  requireDescription?: boolean
}

const defaultReasonOptions = [
  { value: "duplicate", label: "Duplicate Entry" },
  { value: "incorrect_data", label: "Incorrect Data" },
  { value: "suspicious", label: "Suspicious Activity" },
  { value: "incomplete", label: "Incomplete Information" },
  { value: "other", label: "Other" },
]

export function FlagModal({
  isOpen,
  onClose,
  onSubmit,
  title = "Flag this Entry",
  reasonOptions = defaultReasonOptions,
  requireDescription = false,
}: FlagModalProps) {
  const [reason, setReason] = useState("")
  const [description, setDescription] = useState("")
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("low")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason for flagging")
      return
    }

    if (requireDescription && !description.trim()) {
      setError("Please add a comment explaining what needs to be corrected")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      await onSubmit({ reason, description, severity })
      // Reset form
      setReason("")
      setDescription("")
      setSeverity("low")
      onClose()
    } catch {
      setError("Failed to create flag. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      setReason("")
      setDescription("")
      setSeverity("low")
      setError("")
      onClose()
    }
  }

  const severityOptions = [
    { value: "low", label: "Low - Minor issue, not urgent" },
    { value: "medium", label: "Medium - Should be reviewed soon" },
    { value: "high", label: "High - Requires immediate attention" },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Report an issue with this entry for review by administrators.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason for Flagging *</Label>
            <Select
              name="reason"
              options={reasonOptions}
              value={reason}
              onChange={(v) => setReason(v as string)}
              placeholder="Select a reason"
            />
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <RadioButtons
              name="severity"
              options={severityOptions}
              value={severity}
              onChange={(v) => setSeverity(v as "low" | "medium" | "high")}
              direction="vertical"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Additional Details
              {requireDescription ? " *" : ""}
            </Label>
            <Textarea
              placeholder="Provide more context about why you're flagging this entry..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="bg-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          {isSubmitting ? (
            <ButtonLoading text="Submitting..." />
          ) : (
            <Button onClick={handleSubmit} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Flag className="mr-2 h-4 w-4" />
              Submit Flag
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FlagModal
