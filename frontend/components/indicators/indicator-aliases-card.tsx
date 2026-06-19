"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Tag, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { indicatorsService, type IndicatorAlias } from "@/lib/api/services/indicators"
import { useAuth } from "@/lib/contexts/auth-context"
import { canManageOrganizations } from "@/lib/permissions"

/**
 * Manage an indicator's aliases (alternate names that imports resolve to this
 * indicator). Lets admins add/remove aliases from the UI instead of editing
 * import scripts — e.g. so a workbook column that reads "Tobacco screening"
 * maps to the canonical indicator.
 */
export function IndicatorAliasesCard({ indicatorId }: { indicatorId: number }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const canEdit = canManageOrganizations(user)

  const [aliases, setAliases] = useState<IndicatorAlias[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAliases(await indicatorsService.listAliases(indicatorId))
    } catch {
      /* leave list as-is on transient error */
    } finally {
      setLoading(false)
    }
  }, [indicatorId])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      await indicatorsService.createAlias({ indicator: indicatorId, name })
      setNewName("")
      await load()
      toast({ title: "Alias added", description: `Imports will now resolve "${name}" to this indicator.` })
    } catch (err) {
      const detail =
        (err as { payload?: { name?: string[]; detail?: string } })?.payload?.name?.[0] ||
        (err as { payload?: { detail?: string } })?.payload?.detail ||
        "This name may already be used by another indicator."
      toast({ title: "Could not add alias", description: detail, variant: "destructive" })
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (alias: IndicatorAlias) => {
    setRemovingId(alias.id)
    try {
      await indicatorsService.deleteAlias(alias.id)
      setAliases((prev) => prev.filter((a) => a.id !== alias.id))
      toast({ title: "Alias removed", description: `"${alias.name}" no longer maps here.` })
    } catch {
      toast({ title: "Could not remove alias", variant: "destructive" })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Import Aliases</CardTitle>
        </div>
        <CardDescription>
          Alternate names that workbook/data imports resolve to this indicator. Add an alias when an
          import doesn&apos;t match this indicator&apos;s exact name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading aliases…
          </div>
        ) : aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No aliases yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {aliases.map((alias) => (
              <Badge key={alias.id} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1.5 text-sm font-normal">
                {alias.name}
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remove alias ${alias.name}`}
                    className="rounded-full p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    onClick={() => handleRemove(alias)}
                    disabled={removingId === alias.id}
                  >
                    {removingId === alias.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="flex gap-2">
            <Input
              value={newName}
              placeholder="Add an alias name…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void handleAdd()
                }
              }}
              disabled={adding}
            />
            <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default IndicatorAliasesCard
