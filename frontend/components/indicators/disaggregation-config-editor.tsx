"use client"

/**
 * Full editor for an indicator's `aggregate_disaggregation_config` — the single
 * source of truth used by the reporting workbook, aggregate capture, analysis and
 * exports. Admins can: enable/disable, add preset OR custom dimensions, add / edit
 * / remove / reorder values, reorder dimensions, and preview the resulting matrix
 * before saving.
 */
import { useMemo } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DISAGGREGATION_PRESETS,
  DISAGGREGATION_PRESET_OPTIONS,
  createEmptyDisaggregationConfig,
  type AggregateDisaggregationConfig,
  type AggregateDisaggregationDimension,
} from "@/lib/indicators/disaggregation-presets"
import { getAggregateEntryMatrixConfig } from "@/lib/aggregates/aggregate-helpers"

type DenominatorOption = { id: number; name: string; code?: string }

type Props = {
  value: AggregateDisaggregationConfig
  onChange: (next: AggregateDisaggregationConfig) => void
  disabled?: boolean
  // Denominator (percentage indicators only): % = this indicator achieved /
  // denominator indicator achieved. Rendered when indicatorType === "percentage".
  indicatorType?: string
  denominatorId?: number | null
  onDenominatorChange?: (id: number | null) => void
  denominatorOptions?: DenominatorOption[]
  selfId?: number
}

const NO_DENOMINATOR = "__none__"

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

export default function DisaggregationConfigEditor({
  value, onChange, disabled,
  indicatorType, denominatorId, onDenominatorChange, denominatorOptions = [], selfId,
}: Props) {
  const config = value && typeof value === "object" ? value : createEmptyDisaggregationConfig()
  const dimensions = Array.isArray(config.dimensions) ? config.dimensions : []

  const emit = (next: Partial<AggregateDisaggregationConfig>) =>
    onChange({ ...createEmptyDisaggregationConfig(), ...config, ...next })

  const setDimensions = (dims: AggregateDisaggregationDimension[]) =>
    emit({ dimensions: dims, enabled: config.enabled })

  const usedKeys = new Set(dimensions.map((d) => (d.key || "").toLowerCase()))

  const addPreset = (presetKey: string) => {
    const preset = DISAGGREGATION_PRESETS[presetKey as keyof typeof DISAGGREGATION_PRESETS]
    if (!preset || usedKeys.has(preset.key.toLowerCase())) return
    setDimensions([...dimensions, { key: preset.key, label: preset.label, values: [...preset.values] }])
  }

  const addCustom = () => {
    let i = 1
    let key = `custom_${i}`
    while (usedKeys.has(key)) key = `custom_${++i}`
    setDimensions([...dimensions, { key, label: `Custom ${i}`, values: ["Value 1"] }])
  }

  const updateDim = (idx: number, patch: Partial<AggregateDisaggregationDimension>) =>
    setDimensions(dimensions.map((d, i) => (i === idx ? { ...d, ...patch } : d)))

  // Live preview of the reporting matrix from the current config.
  const preview = useMemo(
    () => getAggregateEntryMatrixConfig({ aggregate_disaggregation_config: config }),
    [config],
  )

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Disaggregation Configuration</Label>
          <p className="text-xs text-muted-foreground">
            Defines the reporting/capture structure. Saved as the single source of truth.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{config.enabled ? "Enabled" : "Disabled"}</span>
          <Switch
            checked={Boolean(config.enabled)}
            disabled={disabled}
            onCheckedChange={(checked) => emit({ enabled: checked })}
          />
        </div>
      </div>

      {indicatorType === "percentage" && onDenominatorChange && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <Label className="text-xs font-semibold">Denominator (percentage)</Label>
          <p className="mb-1.5 text-xs text-muted-foreground">
            % = this indicator&apos;s achieved ÷ the denominator&apos;s achieved (its achieved acts as the target).
          </p>
          <Select
            disabled={disabled}
            value={denominatorId ? String(denominatorId) : NO_DENOMINATOR}
            onValueChange={(v) => onDenominatorChange(v === NO_DENOMINATOR ? null : Number(v))}
          >
            <SelectTrigger className="h-8"><SelectValue placeholder="Select denominator indicator…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DENOMINATOR}>None</SelectItem>
              {denominatorOptions
                .filter((o) => o.id !== selfId)
                .map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}{o.code ? ` (${o.code})` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {config.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select disabled={disabled} onValueChange={addPreset} value="">
              <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add preset dimension…" /></SelectTrigger>
              <SelectContent>
                {DISAGGREGATION_PRESET_OPTIONS.filter(
                  (o) => !usedKeys.has(DISAGGREGATION_PRESETS[o.value as keyof typeof DISAGGREGATION_PRESETS]?.key.toLowerCase()),
                ).map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={addCustom}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Custom dimension
            </Button>
          </div>

          {dimensions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add at least one dimension.</p>
          ) : (
            <div className="space-y-3">
              {dimensions.map((dim, di) => (
                <div key={di} className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1"
                      value={dim.label}
                      disabled={disabled}
                      placeholder="Dimension label"
                      onChange={(e) => updateDim(di, { label: e.target.value })}
                    />
                    <Button type="button" size="icon" variant="ghost" disabled={disabled || di === 0}
                      onClick={() => setDimensions(move(dimensions, di, di - 1))} aria-label="Move dimension up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" disabled={disabled || di === dimensions.length - 1}
                      onClick={() => setDimensions(move(dimensions, di, di + 1))} aria-label="Move dimension down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" disabled={disabled}
                      onClick={() => setDimensions(dimensions.filter((_, i) => i !== di))} aria-label="Remove dimension">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {dim.values.map((val, vi) => (
                      <div key={vi} className="flex items-center gap-2">
                        <Input
                          className="h-7 flex-1 text-sm"
                          value={val}
                          disabled={disabled}
                          placeholder={`Value ${vi + 1}`}
                          onChange={(e) =>
                            updateDim(di, { values: dim.values.map((v, i) => (i === vi ? e.target.value : v)) })
                          }
                        />
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || vi === 0}
                          onClick={() => updateDim(di, { values: move(dim.values, vi, vi - 1) })} aria-label="Move value up">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled || vi === dim.values.length - 1}
                          onClick={() => updateDim(di, { values: move(dim.values, vi, vi + 1) })} aria-label="Move value down">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled}
                          onClick={() => updateDim(di, { values: dim.values.filter((_, i) => i !== vi) })} aria-label="Remove value">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" className="h-7" disabled={disabled}
                      onClick={() => updateDim(di, { values: [...dim.values, `Value ${dim.values.length + 1}`] })}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add value
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Live matrix preview */}
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            <div className="mb-1 font-medium">Preview</div>
            {preview.hasDisaggregates ? (
              <div className="flex flex-wrap gap-2">
                {preview.primaryValues.length > 0 && (
                  <Badge variant="secondary">{preview.primaryLabel}: {preview.primaryValues.join(", ")}</Badge>
                )}
                {preview.secondaryValues.length > 0 && (
                  <Badge variant="secondary">{preview.secondaryLabel}: {preview.secondaryValues.join(", ")}</Badge>
                )}
                {preview.bandValues.length > 0 && (
                  <Badge variant="secondary">{preview.bandLabel}: {preview.bandValues.join(", ")}</Badge>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">Single value (no disaggregation).</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
