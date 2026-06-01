"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { Label } from "@/components/ui/label"

export interface CheckboxProps {
  name: string
  label?: string
  value?: boolean
  onChange?: (value: boolean) => void
  disabled?: boolean
  error?: string
  className?: string
}

export function Checkbox({
  name,
  label,
  value = false,
  onChange,
  disabled = false,
  error,
  className,
}: CheckboxProps) {
  const handleToggle = () => {
    if (!disabled && onChange) {
      onChange(!value)
    }
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        id={name}
        role="checkbox"
        aria-checked={value}
        disabled={disabled}
        onClick={handleToggle}
        className={cn(
          "h-5 w-5 shrink-0 rounded border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-input",
          disabled && "cursor-not-allowed opacity-50",
          error && "border-destructive"
        )}
      >
        {value && <Check className="h-4 w-4" />}
      </button>
      {label && (
        <Label
          htmlFor={name}
          className={cn(
            "cursor-pointer select-none",
            disabled && "cursor-not-allowed opacity-50",
            error && "text-destructive"
          )}
          onClick={handleToggle}
        >
          {label}
        </Label>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default Checkbox
