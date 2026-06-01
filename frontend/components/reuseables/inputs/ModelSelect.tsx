"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { X, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export interface ModelSelectProps {
  name: string
  label?: string
  value?: Record<string, unknown>
  onChange?: (value: Record<string, unknown> | null) => void
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

export function ModelSelect({
  name,
  label,
  value,
  onChange,
  disabled = false,
  error,
  className,
  IndexComponent,
  blacklist = [],
  callbackText = "Select Item",
  displayField = "name",
}: ModelSelectProps) {
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (item: Record<string, unknown>) => {
    if (onChange) {
      onChange(item)
    }
    setIsOpen(false)
  }

  const handleClear = () => {
    if (onChange) {
      onChange(null)
    }
  }

  const displayValue = value ? String(value[displayField] || value.id || "Selected") : null

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={name} className={cn(error && "text-destructive")}>
          {label}
        </Label>
      )}
      
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-input p-2">
          <span className="flex-1 text-sm">{displayValue}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={disabled}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                "w-full justify-start gap-2",
                error && "border-destructive"
              )}
            >
              <Search className="h-4 w-4" />
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
                excludeIds={blacklist}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default ModelSelect
