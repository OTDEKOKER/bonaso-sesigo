"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  ChevronDown,
  ChevronUp,
  Flag,
  CheckCircle,
  Clock,
  AlertTriangle,
  User,
} from "lucide-react"
import { format } from "date-fns"

export interface FlagData {
  id: number
  reason: string
  description?: string
  status: "pending" | "resolved" | "dismissed"
  severity: "low" | "medium" | "high"
  created_by?: { id: number; name: string }
  created_at: string
  resolved_by?: { id: number; name: string }
  resolved_at?: string
  resolution_notes?: string
  content_type?: string
  object_id?: number
}

export interface FlagCardProps {
  flag: FlagData
  onResolve?: (id: number, notes: string) => Promise<void>
  onDismiss?: (id: number, notes: string) => Promise<void>
  className?: string
  expandable?: boolean
}

export function FlagCard({
  flag,
  onResolve,
  onDismiss,
  className,
  expandable = true,
}: FlagCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [resolutionNotes, setResolutionNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const severityColors = {
    low: "bg-info/10 text-info border-info/20",
    medium: "bg-warning/10 text-warning border-warning/20",
    high: "bg-destructive/10 text-destructive border-destructive/20",
  }

  const statusIcons = {
    pending: <Clock className="h-4 w-4 text-warning" />,
    resolved: <CheckCircle className="h-4 w-4 text-success" />,
    dismissed: <AlertTriangle className="h-4 w-4 text-muted-foreground" />,
  }

  const handleResolve = async () => {
    if (!onResolve) return
    setIsSubmitting(true)
    try {
      await onResolve(flag.id, resolutionNotes)
      setResolutionNotes("")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    if (!onDismiss) return
    setIsSubmitting(true)
    try {
      await onDismiss(flag.id, resolutionNotes)
      setResolutionNotes("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader
        className={cn(
          "cursor-pointer p-4",
          expandable && "hover:bg-secondary/50"
        )}
        onClick={() => expandable && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Flag className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium">{flag.reason}</p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(flag.created_at), "MMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("border", severityColors[flag.severity])}>
              {flag.severity}
            </Badge>
            {statusIcons[flag.status]}
            {expandable &&
              (isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              ))}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 border-t p-4">
          {flag.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Description
              </p>
              <p className="text-sm">{flag.description}</p>
            </div>
          )}

          {flag.created_by && (
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Flagged by {flag.created_by.name}</span>
            </div>
          )}

          {flag.status === "resolved" && flag.resolved_by && (
            <div className="rounded-md bg-success/10 p-3">
              <p className="text-sm font-medium text-success">Resolved</p>
              <p className="text-sm">
                By {flag.resolved_by.name} on{" "}
                {flag.resolved_at &&
                  format(new Date(flag.resolved_at), "MMM d, yyyy")}
              </p>
              {flag.resolution_notes && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {flag.resolution_notes}
                </p>
              )}
            </div>
          )}

          {flag.status === "pending" && (onResolve || onDismiss) && (
            <div className="space-y-3 border-t pt-4">
              <Textarea
                placeholder="Resolution notes (optional)"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={2}
                className="bg-input"
              />
              <div className="flex gap-2">
                {onResolve && (
                  <Button
                    size="sm"
                    onClick={handleResolve}
                    disabled={isSubmitting}
                  >
                    <CheckCircle className="mr-1 h-4 w-4" />
                    Resolve
                  </Button>
                )}
                {onDismiss && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDismiss}
                    disabled={isSubmitting}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export default FlagCard
