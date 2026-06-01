"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

export interface LoadingProps {
  message?: string
  className?: string
  fullScreen?: boolean
}

export function Loading({
  message = "Loading...",
  className,
  fullScreen = true,
}: LoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        fullScreen && "fixed inset-0 z-50 bg-background",
        className
      )}
    >
      <div className="relative">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <Loader2 className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-primary" />
      </div>
      {message && (
        <p className="text-lg font-medium text-muted-foreground">{message}</p>
      )}
    </div>
  )
}

export default Loading
