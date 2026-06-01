"use client"

import React, { forwardRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { AlertCircle, CheckCircle, AlertTriangle, X } from "lucide-react"

export interface MessagesProps {
  errors?: string[]
  warnings?: string[]
  success?: string[]
  onDismiss?: (type: "error" | "warning" | "success", index: number) => void
  className?: string
  autoScrollOnError?: boolean
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  function Messages(
    {
      errors = [],
      warnings = [],
      success = [],
      onDismiss,
      className,
      autoScrollOnError = true,
    },
    ref
  ) {
    // Auto scroll to messages when errors appear
    useEffect(() => {
      if (autoScrollOnError && errors.length > 0 && ref && "current" in ref && ref.current) {
        ref.current.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    }, [errors, autoScrollOnError, ref])

    const hasMessages = errors.length > 0 || warnings.length > 0 || success.length > 0

    if (!hasMessages) return null

    return (
      <div ref={ref} className={cn("space-y-3", className)}>
        {/* Error Messages */}
        {errors.map((error, index) => (
          <div
            key={`error-${index}`}
            className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="flex-1 text-sm text-destructive">{error}</p>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss("error", index)}
                className="text-destructive/70 hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        {/* Warning Messages */}
        {warnings.map((warning, index) => (
          <div
            key={`warning-${index}`}
            className="flex items-start gap-3 rounded-md border border-warning/20 bg-warning/10 p-3"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="flex-1 text-sm text-warning">{warning}</p>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss("warning", index)}
                className="text-warning/70 hover:text-warning"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        {/* Success Messages */}
        {success.map((msg, index) => (
          <div
            key={`success-${index}`}
            className="flex items-start gap-3 rounded-md border border-success/20 bg-success/10 p-3"
          >
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <p className="flex-1 text-sm text-success">{msg}</p>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss("success", index)}
                className="text-success/70 hover:text-success"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }
)

export default Messages
