"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, Search, X } from "lucide-react"
import { Label } from "@/components/ui/label"

export interface SelectOption {
  value: string | number
  label: string
  [key: string]: unknown
}

export interface SelectProps {
  name: string
  label?: string
  options: SelectOption[]
  value?: string | number
  onChange?: (value: string | number | undefined) => void
  disabled?: boolean
  error?: string
  className?: string
  placeholder?: string
  valueField?: string
  labelField?: string
  search?: boolean
  searchCallback?: (query: string) => Promise<SelectOption[]>
  clearable?: boolean
}

export function Select({
  name,
  label,
  options,
  value,
  onChange,
  disabled = false,
  error,
  className,
  placeholder = "Select an option",
  valueField = "value",
  labelField = "label",
  search = false,
  searchCallback,
  clearable = true,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [remoteOptions, setRemoteOptions] = useState<SelectOption[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((opt) => opt[valueField] === value)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery("")
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && search && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen, search])

  const filteredOptions = useMemo(() => {
    if (!search) {
      return options
    }

    if (searchCallback) {
      return searchQuery ? remoteOptions : options
    }

    return options.filter((opt) =>
      String(opt[labelField]).toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [labelField, options, remoteOptions, search, searchCallback, searchQuery])

  const handleSelect = (optionValue: string | number) => {
    if (onChange) {
      onChange(optionValue)
    }
    setIsOpen(false)
    setSearchQuery("")
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onChange) {
      onChange(undefined)
    }
  }

  return (
    <div className={cn("space-y-2", className)} ref={containerRef}>
      {label && (
        <Label htmlFor={name} className={cn(error && "text-destructive")}>
          {label}
        </Label>
      )}
      <div className="relative">
        <button
          type="button"
          id={name}
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left",
            "bg-input border-border text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
            error && "border-destructive"
          )}
        >
          <span className={cn(!selectedOption && "text-muted-foreground")}>
            {selectedOption ? String(selectedOption[labelField]) : placeholder}
          </span>
          <div className="flex items-center gap-1">
            {clearable && selectedOption && (
              <X
                className="h-4 w-4 text-muted-foreground hover:text-foreground"
                onClick={handleClear}
              />
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </div>
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
            {search && (
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={async (e) => {
                      const nextQuery = e.target.value
                      setSearchQuery(nextQuery)

                      if (!(search && searchCallback && nextQuery)) {
                        setRemoteOptions([])
                        setIsSearching(false)
                        return
                      }

                      setIsSearching(true)
                      try {
                        const results = await searchCallback(nextQuery)
                        setRemoteOptions(results)
                      } finally {
                        setIsSearching(false)
                      }
                    }}
                    placeholder="Search..."
                    className="w-full rounded-md border border-border bg-input py-1.5 pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            )}
            <div className="max-h-60 overflow-auto p-1">
              {isSearching ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  Searching...
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No options found
                </div>
              ) : (
                filteredOptions.map((option) => {
                  const optionValue = option[valueField] as string | number
                  const optionLabel = option[labelField] as string
                  const isSelected = value === optionValue

                  return (
                    <button
                      key={optionValue}
                      type="button"
                      onClick={() => handleSelect(optionValue)}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                        "hover:bg-secondary focus:bg-secondary focus:outline-none",
                        isSelected && "bg-primary/10 text-primary"
                      )}
                    >
                      {optionLabel}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

export default Select
