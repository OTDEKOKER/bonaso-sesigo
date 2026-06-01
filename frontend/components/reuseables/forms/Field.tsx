"use client"

import React from "react"
import { useFormContext, Controller, type RegisterOptions } from "react-hook-form"
import { Input } from "@/components/reuseables/inputs/Input"
import { Select } from "@/components/reuseables/inputs/Select"
import { Checkbox } from "@/components/reuseables/inputs/Checkbox"
import { MultiCheckbox } from "@/components/reuseables/inputs/MultiCheckbox"
import { RadioButtons } from "@/components/reuseables/inputs/RadioButtons"
import { MultiInt } from "@/components/reuseables/inputs/MultiInt"
import { ImageSelect } from "@/components/reuseables/inputs/ImageSelect"
import { ModelSelect } from "@/components/reuseables/inputs/ModelSelect"
import { ModelMultiSelect } from "@/components/reuseables/inputs/ModelMultiSelect"
import { Tooltip } from "@/components/reuseables/Tooltip"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "checkbox"
  | "multi-checkbox"
  | "radio"
  | "multi-int"
  | "image-select"
  | "model-select"
  | "model-multi-select"

export interface FieldOption {
  value: string | number
  label: string
  id?: number
  name?: string
}

export interface FieldProps {
  name: string
  label: string
  type?: FieldType
  rules?: RegisterOptions
  options?: FieldOption[]
  placeholder?: string
  tooltip?: string
  disabled?: boolean
  className?: string
  // For ModelSelect/ModelMultiSelect
  IndexComponent?: React.ComponentType<{
    onSelect: (item: unknown) => void
    excludeIds?: number[]
  }>
  includeParams?: Record<string, string>
  excludeParams?: Record<string, string>
  blacklist?: number[]
  // For Select/Radio
  valueField?: string
  labelField?: string
  // For ImageSelect
  images?: React.ReactNode[]
  multiple?: boolean
  // For Select with search
  search?: boolean
  searchCallback?: (query: string) => Promise<FieldOption[]>
}

export function Field({
  name,
  label,
  type = "text",
  rules,
  options = [],
  placeholder,
  tooltip,
  disabled = false,
  className,
  IndexComponent,
  blacklist,
  valueField = "value",
  labelField = "label",
  images,
  multiple = false,
  search = false,
  searchCallback,
}: FieldProps) {
  const { control, formState: { errors } } = useFormContext()
  
  const error = errors[name]
  const errorMessage = error?.message as string | undefined

  const renderInput = (field: {
    value: unknown
    onChange: (value: unknown) => void
    onBlur: () => void
  }) => {
    const normalizedOptions = options.map((option) => ({
      ...option,
      value: option.value,
      label: option.label,
    }))
    const normalizedMultiIntOptions = options
      .map((option) => {
        const idValue = option.id ?? Number(option.value)
        if (!Number.isFinite(idValue)) return null
        return {
          id: Number(idValue),
          name: option.name || option.label,
        }
      })
      .filter((option): option is { id: number; name: string } => Boolean(option))
    const commonProps = {
      name,
      label,
      value: field.value,
      onChange: field.onChange,
      disabled,
      error: errorMessage,
    }

    switch (type) {
      case "select":
        return (
          <Select
            {...commonProps}
            value={(field.value as string | number | undefined) ?? undefined}
            options={normalizedOptions}
            valueField={valueField}
            labelField={labelField}
            search={search}
            searchCallback={searchCallback as ((query: string) => Promise<Array<{ value: string | number; label: string }>>) | undefined}
            placeholder={placeholder}
          />
        )

      case "checkbox":
        return (
          <Checkbox
            {...commonProps}
            value={field.value as boolean}
            onChange={(v) => field.onChange(v)}
          />
        )

      case "multi-checkbox":
        return (
          <MultiCheckbox
            {...commonProps}
            options={normalizedOptions}
            value={field.value as (string | number)[]}
            onChange={(v) => field.onChange(v)}
            valueField={valueField}
            labelField={labelField}
          />
        )

      case "radio":
        return (
          <RadioButtons
            {...commonProps}
            options={normalizedOptions}
            value={(field.value as string | number | undefined) ?? undefined}
            onChange={(v) => field.onChange(v)}
            valueField={valueField}
            labelField={labelField}
          />
        )

      case "multi-int":
        return (
          <MultiInt
            {...commonProps}
            options={normalizedMultiIntOptions}
            value={field.value as { value: number | null; option: number }[]}
            onChange={(v) => field.onChange(v)}
          />
        )

      case "image-select":
        return (
          <ImageSelect
            {...commonProps}
            options={normalizedOptions}
            images={images || []}
            multiple={multiple}
            value={(field.value as string | number | (string | number)[] | undefined) ?? undefined}
            onChange={(v) => field.onChange(v)}
          />
        )

      case "model-select":
        if (!IndexComponent) {
          console.error("ModelSelect requires IndexComponent prop")
          return null
        }
        return (
          <ModelSelect
            {...commonProps}
            value={(field.value as Record<string, unknown> | null | undefined) ?? null}
            IndexComponent={IndexComponent}
            blacklist={blacklist}
            callbackText={placeholder || `Choose ${label}`}
            onChange={(v) => field.onChange(v)}
          />
        )

      case "model-multi-select":
        if (!IndexComponent) {
          console.error("ModelMultiSelect requires IndexComponent prop")
          return null
        }
        return (
          <ModelMultiSelect
            {...commonProps}
            value={(Array.isArray(field.value) ? field.value : []) as Record<string, unknown>[]}
            IndexComponent={IndexComponent}
            blacklist={blacklist}
            callbackText={placeholder || `Add ${label}`}
            onChange={(v) => field.onChange(v)}
          />
        )

      case "textarea":
        return (
          <Input
            {...commonProps}
            type="textarea"
            placeholder={placeholder}
            value={field.value as string}
            onChange={(e) => field.onChange(e.target.value)}
          />
        )

      case "number":
      case "email":
      case "password":
      case "date":
      case "text":
      default:
        return (
          <Input
            {...commonProps}
            type={type}
            placeholder={placeholder}
            value={field.value as string}
            onChange={(e) => field.onChange(e.target.value)}
          />
        )
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {type !== "checkbox" && (
        <div className="flex items-center gap-2">
          <Label htmlFor={name} className={cn(error && "text-destructive")}>
            {label}
            {rules?.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {tooltip && <Tooltip msg={tooltip} />}
        </div>
      )}
      
      <Controller
        name={name}
        control={control}
        rules={rules}
        render={({ field }) => renderInput(field)}
      />
      
      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </div>
  )
}

export default Field
