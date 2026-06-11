"use client"

import { useEffect, useState } from "react"
import { Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { usersService, type ModulePermissionRow } from "@/lib/api"

type ModuleState = Record<string, { enabled: boolean; actions: Set<string> }>

function prettyLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Admin editor for a user's granular module permissions (readiness: granular
 * access). Pre-loads from the user's custom rows, falling back to role defaults,
 * and saves a complete set so the backend resolution is fully determined.
 * Backend is the source of truth and re-enforces everything.
 */
export function ModuleAccessEditor({ userId, role }: { userId: number; role: string }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<Record<string, string[]>>({})
  const [roleDefaults, setRoleDefaults] = useState<Record<string, string[]>>({})
  const [state, setState] = useState<ModuleState>({})

  useEffect(() => {
    let active = true
    setLoading(true)
    usersService
      .getModulePermissions(userId)
      .then((res) => {
        if (!active) return
        setCatalog(res.modules)
        setRoleDefaults(res.role_defaults)
        const custom = new Map(res.custom.map((row) => [row.module, row]))
        const next: ModuleState = {}
        for (const moduleKey of Object.keys(res.modules)) {
          const row = custom.get(moduleKey)
          if (row) {
            next[moduleKey] = { enabled: row.is_enabled !== false, actions: new Set(row.actions || []) }
          } else {
            const def = res.role_defaults[moduleKey] || []
            next[moduleKey] = { enabled: def.length > 0, actions: new Set(def) }
          }
        }
        setState(next)
      })
      .catch(() => active && toast({ title: "Failed to load module permissions", variant: "destructive" }))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId, toast])

  const loadRoleDefaults = () => {
    const next: ModuleState = {}
    for (const moduleKey of Object.keys(catalog)) {
      const def = roleDefaults[moduleKey] || []
      next[moduleKey] = { enabled: def.length > 0, actions: new Set(def) }
    }
    setState(next)
    toast({ title: `Loaded ${prettyLabel(role)} defaults`, description: "Review and Save to apply." })
  }

  const toggleModule = (module: string, enabled: boolean) => {
    setState((current) => {
      const existing = current[module]?.actions ?? new Set<string>()
      const actions =
        enabled && existing.size === 0
          ? new Set(roleDefaults[module]?.length ? roleDefaults[module] : ["view"])
          : existing
      return { ...current, [module]: { enabled, actions } }
    })
  }

  const toggleAction = (module: string, action: string, checked: boolean) => {
    setState((current) => {
      const actions = new Set(current[module]?.actions ?? [])
      if (checked) actions.add(action)
      else actions.delete(action)
      return { ...current, [module]: { enabled: current[module]?.enabled ?? true, actions } }
    })
  }

  const save = async () => {
    setSaving(true)
    const rows: ModulePermissionRow[] = Object.keys(catalog).map((module) => ({
      module,
      is_enabled: Boolean(state[module]?.enabled),
      actions: state[module]?.enabled
        ? Array.from(state[module].actions).filter((a) => catalog[module].includes(a))
        : [],
    }))
    try {
      await usersService.setModulePermissions(userId, rows)
      toast({ title: "Module permissions saved", description: "Takes effect on the user's next refresh." })
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not save module permissions.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">Module Access</CardTitle>
          <CardDescription>
            Choose which modules this user can see and what they can do inside each. Leave as the
            role default, or customize. Saved permissions override role defaults.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadRoleDefaults} disabled={loading || saving}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Load {prettyLabel(role)} defaults
          </Button>
          <Button size="sm" onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading module permissions…
          </div>
        ) : (
          <div className="space-y-3">
            {Object.keys(catalog).map((module) => {
              const moduleState = state[module] ?? { enabled: false, actions: new Set<string>() }
              return (
                <div key={module} className="rounded-lg border border-border/70 p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={moduleState.enabled}
                      onChange={(event) => toggleModule(module, event.target.checked)}
                    />
                    {prettyLabel(module)}
                  </label>
                  {moduleState.enabled ? (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                      {(catalog[module] || []).map((action) => (
                        <label key={action} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={moduleState.actions.has(action)}
                            onChange={(event) => toggleAction(module, action, event.target.checked)}
                          />
                          {prettyLabel(action)}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
