"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/reuseables/inputs/Select"
import { Input } from "@/components/reuseables/inputs/Input"
import { Checkbox } from "@/components/reuseables/inputs/Checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Filter as FilterIcon, X, RotateCcw } from "lucide-react"

export interface FilterField {
  name: string
  label: string
  type: "select" | "text" | "number" | "date" | "checkbox"
  options?: { value: string | number; label: string }[]
  placeholder?: string
}

export interface FilterConfig {
  fields: FilterField[]
  initialValues: Record<string, unknown>
}

export interface FilterProps {
  config: FilterConfig
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  className?: string
}

export function Filter({
  config,
  values,
  onChange,
  className,
}: FilterProps) {
  const [isOpen, setIsOpen] = useState(false)

  const activeFilterCount = Object.entries(values).filter(
    ([key, val]) => val !== config.initialValues[key] && val !== "" && val !== null
  ).length

  const handleFieldChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value })
  }

  const handleReset = () => {
    onChange(config.initialValues)
  }

  const handleClearField = (name: string) => {
    onChange({ ...values, [name]: config.initialValues[name] })
  }

  const renderField = (field: FilterField) => {
    const value = values[field.name]

    switch (field.type) {
      case "select":
        return (
          <Select
            name={field.name}
            label={field.label}
            options={field.options || []}
            value={value as string | number}
            onChange={(v) => handleFieldChange(field.name, v)}
            placeholder={field.placeholder}
          />
        )

      case "checkbox":
        return (
          <Checkbox
            name={field.name}
            label={field.label}
            value={value as boolean}
            onChange={(v) => handleFieldChange(field.name, v)}
          />
        )

      case "number":
      case "date":
      case "text":
      default:
        return (
          <Input
            name={field.name}
            label={field.label}
            type={field.type}
            value={value as string}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
          />
        )
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("gap-2", className)}
        >
          <FilterIcon className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Filters</h4>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-auto gap-1 p-1 text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {config.fields.map((field) => (
              <div key={field.name} className="relative">
                {renderField(field)}
                {values[field.name] !== config.initialValues[field.name] &&
                  values[field.name] !== "" &&
                  values[field.name] !== null && (
                    <button
                      type="button"
                      onClick={() => handleClearField(field.name)}
                      className="absolute right-0 top-0 p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default Filter
