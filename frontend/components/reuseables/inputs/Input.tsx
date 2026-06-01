"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Input as ShadcnInput } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

export interface InputProps {
  name: string
  label?: string
  type?: "text" | "email" | "password" | "number" | "date" | "textarea"
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  error?: string
  className?: string
  min?: number
  max?: number
  step?: number
  rows?: number
}

export function Input({
  name,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  error,
  className,
  min,
  max,
  step,
  rows = 4,
}: InputProps) {
  const inputClassName = cn(
    "bg-input border-border text-foreground placeholder:text-muted-foreground",
    error && "border-destructive focus-visible:ring-destructive",
    className
  )

  if (type === "textarea") {
    return (
      <div className="space-y-2">
        {label && (
          <Label htmlFor={name} className={cn(error && "text-destructive")}>
            {label}
          </Label>
        )}
        <Textarea
          id={name}
          name={name}
          value={value ?? ""}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className={inputClassName}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {label && (
        <Label htmlFor={name} className={cn(error && "text-destructive")}>
          {label}
        </Label>
      )}
      <ShadcnInput
        id={name}
        name={name}
        type={type}
        value={value ?? ""}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        className={inputClassName}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default Input
