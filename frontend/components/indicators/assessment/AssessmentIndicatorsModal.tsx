"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ComponentLoading } from "@/components/reuseables/loading/ComponentLoading"
import {
  FileText,
  CheckSquare,
  Hash,
  List,
  ToggleLeft,
  ArrowRight,
} from "lucide-react"

export interface AssessmentIndicator {
  id: number
  code: string
  name: string
  description?: string
  indicator_type: string
  options?: { id: number; label: string }[]
  logic?: {
    condition: string
    target_indicator?: string
  }[]
}

export interface Assessment {
  id: number
  name: string
  description?: string
  indicators: AssessmentIndicator[]
}

export interface AssessmentIndicatorsModalProps {
  isOpen: boolean
  onClose: () => void
  assessment?: Assessment | null
  isLoading?: boolean
}

const indicatorTypeIcons: Record<string, React.ReactNode> = {
  text: <FileText className="h-4 w-4" />,
  number: <Hash className="h-4 w-4" />,
  yes_no: <ToggleLeft className="h-4 w-4" />,
  select: <List className="h-4 w-4" />,
  multiselect: <CheckSquare className="h-4 w-4" />,
  multi_number: <Hash className="h-4 w-4" />,
}

const indicatorTypeLabels: Record<string, string> = {
  text: "Text",
  number: "Number",
  yes_no: "Yes/No",
  select: "Single Select",
  multiselect: "Multi Select",
  multi_number: "Multiple Numbers",
}

export function AssessmentIndicatorsModal({
  isOpen,
  onClose,
  assessment,
  isLoading = false,
}: AssessmentIndicatorsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {assessment?.name || "Assessment Preview"}
          </DialogTitle>
          {assessment?.description && (
            <p className="text-sm text-muted-foreground">
              {assessment.description}
            </p>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <ComponentLoading size="lg" />
            </div>
          ) : !assessment ? (
            <div className="py-12 text-center text-muted-foreground">
              No assessment data available
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {assessment.indicators.length} indicator(s) in this assessment
              </div>

              <div className="space-y-3">
                {assessment.indicators.map((indicator, index) => (
                  <div
                    key={indicator.id}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-muted-foreground">
                            {index + 1}.
                          </span>
                          <Badge variant="outline" className="font-mono text-xs">
                            {indicator.code}
                          </Badge>
                          <Badge variant="secondary" className="gap-1">
                            {indicatorTypeIcons[indicator.indicator_type] || (
                              <FileText className="h-3 w-3" />
                            )}
                            {indicatorTypeLabels[indicator.indicator_type] ||
                              indicator.indicator_type}
                          </Badge>
                        </div>
                        <h4 className="mt-2 font-medium">{indicator.name}</h4>
                        {indicator.description && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {indicator.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Options for select/multiselect */}
                    {indicator.options && indicator.options.length > 0 && (
                      <div className="mt-3 border-t pt-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Options:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {indicator.options.map((option) => (
                            <Badge
                              key={option.id}
                              variant="outline"
                              className="text-xs"
                            >
                              {option.label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Logic/Skip conditions */}
                    {indicator.logic && indicator.logic.length > 0 && (
                      <div className="mt-3 rounded-md bg-muted/50 p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Skip Logic:
                        </p>
                        <div className="space-y-1">
                          {indicator.logic.map((logic, logicIndex) => (
                            <div
                              key={logicIndex}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span className="text-muted-foreground">If</span>
                              <span className="font-medium">{logic.condition}</span>
                              {logic.target_indicator && (
                                <>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-primary">
                                    Go to {logic.target_indicator}
                                  </span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AssessmentIndicatorsModal
