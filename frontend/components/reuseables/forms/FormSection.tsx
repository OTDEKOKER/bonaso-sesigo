"use client"

import React from "react"
import { useFormContext, useWatch } from "react-hook-form"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"

export interface WatchCondition {
  field: string
  value: unknown
  operator?: "equals" | "notEquals" | "includes" | "truthy" | "falsy"
}

export interface FormSectionProps {
  children: React.ReactNode
  header?: string
  description?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  showWhen?: WatchCondition | WatchCondition[]
  className?: string
}

export function FormSection({
  children,
  header,
  description,
  collapsible = false,
  defaultCollapsed = false,
  showWhen,
  className,
}: FormSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const { control } = useFormContext()
  
  // Get watch fields if showWhen is provided
  const watchFields = showWhen
    ? Array.isArray(showWhen)
      ? showWhen.map((c) => c.field)
      : [showWhen.field]
    : []
  
  const watchedValues = useWatch({
    control,
    name: watchFields,
  })

  // Evaluate visibility conditions
  const evaluateCondition = (condition: WatchCondition, value: unknown): boolean => {
    switch (condition.operator) {
      case "notEquals":
        return value !== condition.value
      case "includes":
        return Array.isArray(value) && value.includes(condition.value)
      case "truthy":
        return Boolean(value)
      case "falsy":
        return !value
      case "equals":
      default:
        return value === condition.value
    }
  }

  const isVisible = (): boolean => {
    if (!showWhen) return true
    
    if (Array.isArray(showWhen)) {
      return showWhen.every((condition, index) => {
        const value = Array.isArray(watchedValues) ? watchedValues[index] : watchedValues
        return evaluateCondition(condition, value)
      })
    }
    
    return evaluateCondition(showWhen, watchedValues)
  }

  if (!isVisible()) {
    return null
  }

  return (
    <div className={cn("space-y-4", className)}>
      {header && (
        <div
          className={cn(
            "flex items-center gap-2",
            collapsible && "cursor-pointer select-none"
          )}
          onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
        >
          {collapsible && (
            <span className="text-muted-foreground">
              {isCollapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <ChevronDown className="h-5 w-5" />
              )}
            </span>
          )}
          <div>
            <h3 className="text-lg font-semibold text-foreground">{header}</h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      )}
      
      {!isCollapsed && (
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      )}
    </div>
  )
}

export default FormSection
