"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export interface MultiIntOption {
  id: number
  name: string
  [key: string]: unknown
}

export interface MultiIntValue {
  value: number | null
  option: number
}

export interface MultiIntProps {
  name: string
  label?: string
  options: MultiIntOption[]
  value?: MultiIntValue[]
  onChange?: (value: MultiIntValue[]) => void
  disabled?: boolean
  error?: string
  className?: string
  min?: number
  max?: number
}

export function MultiInt({
  name,
  label,
  options,
  value = [],
  onChange,
  disabled = false,
  error,
  className,
  min,
  max,
}: MultiIntProps) {
  // Initialize values for all options if not present
  const getValueForOption = (optionId: number): number | null => {
    const existing = value.find((v) => v.option === optionId)
    return existing?.value ?? null
  }

  const handleValueChange = (optionId: number, newValue: string) => {
    if (!onChange) return

    const numValue = newValue === "" ? null : Number(newValue)
    
    // Validate min/max
    if (numValue !== null) {
      if (min !== undefined && numValue < min) return
      if (max !== undefined && numValue > max) return
    }

    const existingIndex = value.findIndex((v) => v.option === optionId)
    let newValues: MultiIntValue[]

    if (existingIndex >= 0) {
      newValues = [...value]
      newValues[existingIndex] = { value: numValue, option: optionId }
    } else {
      newValues = [...value, { value: numValue, option: optionId }]
    }

    onChange(newValues)
  }

  const total = value.reduce((sum, v) => sum + (v.value || 0), 0)

  return (
    <div className={cn("space-y-3", className)} data-name={name}>
      {label && (
        <div className="flex items-center justify-between">
          <Label className={cn(error && "text-destructive")}>{label}</Label>
          <span className="text-sm text-muted-foreground">Total: {total}</span>
        </div>
      )}
      <div className="space-y-2">
        {options.map((option) => (
          <div key={option.id} className="flex items-center gap-3">
            <Label className="min-w-32 text-sm">{option.name}</Label>
            <Input
              type="number"
              value={getValueForOption(option.id) ?? ""}
              onChange={(e) => handleValueChange(option.id, e.target.value)}
              disabled={disabled}
              min={min}
              max={max}
              className={cn(
                "w-24 bg-input",
                error && "border-destructive"
              )}
              placeholder="0"
            />
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default MultiInt
