"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Check } from "lucide-react"

export interface ImageSelectOption {
  value: string | number
  label: string
  [key: string]: unknown
}

export interface ImageSelectProps {
  name: string
  label?: string
  options: ImageSelectOption[]
  images: React.ReactNode[]
  value?: string | number | (string | number)[]
  onChange?: (value: string | number | (string | number)[]) => void
  disabled?: boolean
  error?: string
  className?: string
  multiple?: boolean
}

export function ImageSelect({
  name,
  label,
  options,
  images,
  value,
  onChange,
  disabled = false,
  error,
  className,
  multiple = false,
}: ImageSelectProps) {
  const isSelected = (optionValue: string | number): boolean => {
    if (multiple && Array.isArray(value)) {
      return value.includes(optionValue)
    }
    return value === optionValue
  }

  const handleSelect = (optionValue: string | number) => {
    if (disabled || !onChange) return

    if (multiple) {
      const currentValues = Array.isArray(value) ? value : []
      if (currentValues.includes(optionValue)) {
        onChange(currentValues.filter((v) => v !== optionValue))
      } else {
        onChange([...currentValues, optionValue])
      }
    } else {
      onChange(optionValue)
    }
  }

  return (
    <div className={cn("space-y-3", className)} data-name={name}>
      {label && (
        <Label className={cn(error && "text-destructive")}>{label}</Label>
      )}
      <div className="flex flex-wrap gap-3">
        {options.map((option, index) => {
          const selected = isSelected(option.value)
          const image = images[index]

          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "group relative flex flex-col items-center gap-2 rounded-lg border p-4 transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-input hover:border-primary/50 hover:bg-secondary",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {selected && (
                <div className="absolute -right-1 -top-1 rounded-full bg-primary p-1">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
              <div className="text-3xl">{image}</div>
              <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100">
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default ImageSelect
