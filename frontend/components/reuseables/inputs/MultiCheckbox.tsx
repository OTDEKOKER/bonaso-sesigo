"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { Label } from "@/components/ui/label"

export interface MultiCheckboxOption {
  value: string | number
  label: string
  [key: string]: unknown
}

export interface MultiCheckboxProps {
  name: string
  label?: string
  options: MultiCheckboxOption[]
  value?: (string | number)[]
  onChange?: (value: (string | number)[]) => void
  disabled?: boolean
  error?: string
  className?: string
  valueField?: string
  labelField?: string
  columns?: 1 | 2 | 3 | 4
}

export function MultiCheckbox({
  name,
  label,
  options,
  value = [],
  onChange,
  disabled = false,
  error,
  className,
  valueField = "value",
  labelField = "label",
  columns = 2,
}: MultiCheckboxProps) {
  const handleToggle = (optionValue: string | number) => {
    if (disabled || !onChange) return

    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue]

    onChange(newValue)
  }

  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }

  return (
    <div className={cn("space-y-3", className)} data-name={name}>
      {label && (
        <Label className={cn(error && "text-destructive")}>{label}</Label>
      )}
      <div className={cn("grid gap-2", gridCols[columns])}>
        {options.map((option) => {
          const optionValue = option[valueField] as string | number
          const optionLabel = option[labelField] as string
          const isChecked = value.includes(optionValue)

          return (
            <button
              key={optionValue}
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              disabled={disabled}
              onClick={() => handleToggle(optionValue)}
              className={cn(
                "flex items-center gap-2 rounded-md border p-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isChecked
                  ? "border-primary bg-primary/10"
                  : "border-border bg-input hover:bg-secondary",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <div
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isChecked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground"
                )}
              >
                {isChecked && <Check className="h-3 w-3" />}
              </div>
              <span className="text-sm">{optionLabel}</span>
            </button>
          )
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default MultiCheckbox
