"use client"

import { useMemo } from "react"
import { RotateCcw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  buildDisaggregationConfigFromPresetKeys,
  DISAGGREGATION_PRESET_OPTIONS,
  getDisaggregationPreset,
  groupPresetKeysForTableLayout,
  normalizePresetKeysForTableLayout,
  type DisaggregationPresetKey,
} from "@/lib/indicators/disaggregation-presets"

type DisaggregationBuilderProps = {
  value: DisaggregationPresetKey[]
  onChange: (next: DisaggregationPresetKey[]) => void
}

export default function DisaggregationBuilder(props: DisaggregationBuilderProps) {
  const { value, onChange } = props
  const normalizedValue = useMemo(() => normalizePresetKeysForTableLayout(value), [value])
  const selectedSet = useMemo(() => new Set(normalizedValue), [normalizedValue])
  const groupedSelection = useMemo(
    () => groupPresetKeysForTableLayout(normalizedValue),
    [normalizedValue],
  )
  const configPreview = useMemo(
    () => buildDisaggregationConfigFromPresetKeys(normalizedValue),
    [normalizedValue],
  )

  const togglePreset = (presetKey: DisaggregationPresetKey, checked: boolean) => {
    if (checked) {
      onChange(normalizePresetKeysForTableLayout([...normalizedValue, presetKey]))
      return
    }
    onChange(normalizePresetKeysForTableLayout(normalizedValue.filter((key) => key !== presetKey)))
  }

  const removePreset = (presetKey: DisaggregationPresetKey) => {
    onChange(normalizePresetKeysForTableLayout(normalizedValue.filter((key) => key !== presetKey)))
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <Label>Disaggregation Builder</Label>
        <p className="text-xs text-muted-foreground">
          Select presets and they will be grouped to match table layout: Rows, Columns, then Bands.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Available Presets
          </p>
          <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {DISAGGREGATION_PRESET_OPTIONS.map((option) => {
              const htmlId = `disaggregation-preset-${option.value}`
              return (
                <label
                  key={option.value}
                  htmlFor={htmlId}
                  className="flex cursor-pointer items-center gap-2 rounded-md p-1 hover:bg-muted/40"
                >
                  <Checkbox
                    id={htmlId}
                    checked={selectedSet.has(option.value)}
                    onCheckedChange={(checked) =>
                      togglePreset(option.value, Boolean(checked))
                    }
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Selected Order
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => onChange([])}
              disabled={normalizedValue.length === 0}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>

          {normalizedValue.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No dimensions selected.
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-border p-3">
              {[
                {
                  title: "Row Group",
                  help: "Left table columns",
                  keys: groupedSelection.rowPresetKeys,
                },
                {
                  title: "Column Group",
                  help: "Middle table split (e.g. Sex)",
                  keys: groupedSelection.columnPresetKeys,
                },
                {
                  title: "Band Group",
                  help: "Top numeric bands (e.g. Age Range)",
                  keys: groupedSelection.bandPresetKeys,
                },
              ].map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {group.title} | {group.help}
                  </p>
                  {group.keys.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                      None selected
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {group.keys.map((presetKey) => {
                        const preset = getDisaggregationPreset(presetKey)
                        return (
                          <div key={presetKey} className="flex items-center justify-between gap-2 rounded-md border border-border/70 p-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{preset.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {preset.values.length} value{preset.values.length === 1 ? "" : "s"}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => removePreset(presetKey)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={configPreview.enabled ? "default" : "secondary"}>
            {configPreview.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Badge variant="outline">Layout: {configPreview.layout}</Badge>
          <Badge variant="outline">{configPreview.dimensions.length} dimensions</Badge>
        </div>
        {configPreview.dimensions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {configPreview.dimensions.map((dimension) => (
              <Badge
                key={`${dimension.key}-${dimension.label}`}
                variant="secondary"
                className="font-normal"
              >
                {dimension.label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
