"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { X, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export interface ModelMultiSelectProps {
  name: string
  label?: string
  value?: Record<string, unknown>[]
  onChange?: (value: Record<string, unknown>[]) => void
  disabled?: boolean
  error?: string
  className?: string
  IndexComponent: React.ComponentType<{
    onSelect: (item: Record<string, unknown>) => void
    excludeIds?: number[]
  }>
  blacklist?: number[]
  callbackText?: string
  displayField?: string
}

export function ModelMultiSelect({
  name,
  label,
  value = [],
  onChange,
  disabled = false,
  error,
  className,
  IndexComponent,
  blacklist = [],
  callbackText = "Add Item",
  displayField = "name",
}: ModelMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Combine blacklist with already selected items
  const excludeIds = [
    ...blacklist,
    ...value.map((item) => item.id as number).filter(Boolean),
  ]

  const handleSelect = (item: Record<string, unknown>) => {
    if (onChange) {
      onChange([...value, item])
    }
    setIsOpen(false)
  }

  const handleRemove = (index: number) => {
    if (onChange) {
      const newValue = [...value]
      newValue.splice(index, 1)
      onChange(newValue)
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={name} className={cn(error && "text-destructive")}>
          {label}
        </Label>
      )}
      
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => {
            const displayValue = String(item[displayField] || item.id || `Item ${index + 1}`)
            return (
              <div
                key={item.id as number || index}
                className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1"
              >
                <span className="text-sm">{displayValue}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  disabled={disabled}
                  className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={cn(
              "gap-2",
              error && "border-destructive"
            )}
          >
            <Plus className="h-4 w-4" />
            {callbackText}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{callbackText}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <IndexComponent
              onSelect={handleSelect}
              excludeIds={excludeIds}
            />
          </div>
        </DialogContent>
      </Dialog>
      
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default ModelMultiSelect
