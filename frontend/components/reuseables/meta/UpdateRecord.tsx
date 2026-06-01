"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { User, Clock, Edit } from "lucide-react"
import { format } from "date-fns"

export interface UpdateRecordUser {
  id: number
  name?: string
  username?: string
  email?: string
}

export interface UpdateRecordProps {
  created_by?: UpdateRecordUser | null
  created_at?: string | null
  updated_by?: UpdateRecordUser | null
  updated_at?: string | null
  className?: string
  compact?: boolean
}

export function UpdateRecord({
  created_by,
  created_at,
  updated_by,
  updated_at,
  className,
  compact = false,
}: UpdateRecordProps) {
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null
    try {
      return format(new Date(dateStr), compact ? "MMM d, yyyy" : "MMMM d, yyyy 'at' h:mm a")
    } catch {
      return dateStr
    }
  }

  const getUserName = (user: UpdateRecordUser | null | undefined) => {
    if (!user) return "Unknown"
    return user.name || user.username || user.email || `User #${user.id}`
  }

  const hasCreated = created_by || created_at
  const hasUpdated = updated_by || updated_at

  if (!hasCreated && !hasUpdated) return null

  if (compact) {
    return (
      <div className={cn("flex flex-wrap gap-4 text-xs text-muted-foreground", className)}>
        {hasCreated && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Created {formatDate(created_at)}
            {created_by && ` by ${getUserName(created_by)}`}
          </span>
        )}
        {hasUpdated && updated_at !== created_at && (
          <span className="flex items-center gap-1">
            <Edit className="h-3 w-3" />
            Updated {formatDate(updated_at)}
            {updated_by && ` by ${getUserName(updated_by)}`}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={cn("rounded-md border border-border bg-muted/30 p-4", className)}>
      <h4 className="mb-3 text-sm font-medium text-muted-foreground">Record History</h4>
      <div className="space-y-3">
        {hasCreated && (
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/10 p-2">
              <Clock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Created</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(created_at)}
              </p>
              {created_by && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <User className="h-3 w-3" />
                  {getUserName(created_by)}
                </p>
              )}
            </div>
          </div>
        )}

        {hasUpdated && updated_at !== created_at && (
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-info/10 p-2">
              <Edit className="h-4 w-4 text-info" />
            </div>
            <div>
              <p className="text-sm font-medium">Last Updated</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(updated_at)}
              </p>
              {updated_by && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <User className="h-3 w-3" />
                  {getUserName(updated_by)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UpdateRecord
