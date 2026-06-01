"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { UserPermissionOption } from "@/lib/api"

interface UserPermissionsManagerProps {
  availablePermissions: UserPermissionOption[]
  value: string[]
  onChange: (permissions: string[]) => void
  isLoading?: boolean
  errorMessage?: string
  onRetry?: () => void
  disabled?: boolean
  className?: string
}

function formatAppLabel(appLabel: string): string {
  return appLabel.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

export function UserPermissionsManager({
  availablePermissions,
  value,
  onChange,
  isLoading = false,
  errorMessage,
  onRetry,
  disabled = false,
  className,
}: UserPermissionsManagerProps) {
  const [query, setQuery] = useState("")

  const filteredPermissions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availablePermissions
    return availablePermissions.filter((permission) =>
      `${permission.app_label} ${permission.codename} ${permission.name}`.toLowerCase().includes(q),
    )
  }, [availablePermissions, query])

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, UserPermissionOption[]>()
    for (const permission of filteredPermissions) {
      const key = permission.app_label
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(permission)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredPermissions])

  const selectedSet = useMemo(() => new Set(value), [value])
  const visibleIds = useMemo(() => filteredPermissions.map((permission) => permission.id), [filteredPermissions])
  const selectedCount = value.length
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id))

  const togglePermission = (permissionId: string, checked: boolean) => {
    if (checked) {
      if (selectedSet.has(permissionId)) return
      onChange([...value, permissionId])
      return
    }
    onChange(value.filter((id) => id !== permissionId))
  }

  const selectVisible = (checked: boolean) => {
    if (checked) {
      const next = new Set(value)
      for (const id of visibleIds) next.add(id)
      onChange(Array.from(next))
      return
    }
    const visibleSet = new Set(visibleIds)
    onChange(value.filter((id) => !visibleSet.has(id)))
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <Label>User Permissions</Label>
        <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search permissions..."
        disabled={disabled || isLoading || !!errorMessage}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => selectVisible(!allVisibleSelected)}
          disabled={disabled || isLoading || !!errorMessage || visibleIds.length === 0}
        >
          {allVisibleSelected ? "Clear Visible" : "Select Visible"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          disabled={disabled || isLoading || !!errorMessage || value.length === 0}
        >
          Clear All
        </Button>
      </div>

      <div className="rounded-md border border-border">
        <ScrollArea className="h-64 p-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading permissions...</p>
          ) : errorMessage ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{errorMessage}</p>
              {onRetry ? (
                <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              ) : null}
            </div>
          ) : groupedPermissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No permissions found.</p>
          ) : (
            <div className="space-y-4">
              {groupedPermissions.map(([appLabel, permissions]) => (
                <div key={appLabel} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatAppLabel(appLabel)}
                  </p>
                  <div className="space-y-2">
                    {permissions.map((permission) => {
                      const checked = selectedSet.has(permission.id)
                      const inputId = `permission-${permission.id}`
                      return (
                        <label
                          key={permission.id}
                          htmlFor={inputId}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-md border border-border p-2",
                            checked && "border-primary/40 bg-primary/5",
                            (disabled || isLoading) && "cursor-not-allowed opacity-70",
                          )}
                        >
                          <Checkbox
                            id={inputId}
                            checked={checked}
                            disabled={disabled || isLoading}
                            onCheckedChange={(nextValue) => togglePermission(permission.id, nextValue === true)}
                          />
                          <span className="text-sm">
                            <span className="font-medium text-foreground">{permission.name}</span>
                            <span className="block text-xs text-muted-foreground">{permission.id}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
