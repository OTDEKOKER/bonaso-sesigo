"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Circle, CircleDot } from "lucide-react"
import { Label } from "@/components/ui/label"

export interface RadioOption {
  value: string | number
  label: string
  [key: string]: unknown
}

export interface RadioButtonsProps {
  name: string
  label?: string
  options: RadioOption[]
  value?: string | number
  onChange?: (value: string | number) => void
  disabled?: boolean
  error?: string
  className?: string
  valueField?: string
  labelField?: string
  direction?: "horizontal" | "vertical"
}

export function RadioButtons({
  name,
  label,
  options,
  value,
  onChange,
  disabled = false,
  error,
  className,
  valueField = "value",
  labelField = "label",
  direction = "vertical",
}: RadioButtonsProps) {
  const handleSelect = (optionValue: string | number) => {
    if (!disabled && onChange) {
      onChange(optionValue)
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {label && (
        <Label className={cn(error && "text-destructive")}>{label}</Label>
      )}
      <div
        className={cn(
          "flex gap-3",
          direction === "vertical" ? "flex-col" : "flex-row flex-wrap"
        )}
        role="radiogroup"
        aria-labelledby={`${name}-label`}
      >
        {options.map((option) => {
          const optionValue = option[valueField] as string | number
          const optionLabel = option[labelField] as string
          const isSelected = value === optionValue

          return (
            <button
              key={optionValue}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => handleSelect(optionValue)}
              className={cn(
                "flex items-center gap-2 rounded-md border p-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-input hover:bg-secondary",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {isSelected ? (
                <CircleDot className="h-4 w-4 text-primary" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm">{optionLabel}</span>
            </button>
          )
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default RadioButtons
