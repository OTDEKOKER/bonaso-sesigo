"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ArrowLeft } from "lucide-react"

export interface ReturnLinkProps {
  url: string
  label: string
  className?: string
}

export function ReturnLink({ url, label, className }: ReturnLinkProps) {
  const router = useRouter()

  return (
    <div className={cn("mb-4", className)}>
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back()
            return
          }
          router.push(url)
        }}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {label}
      </button>
    </div>
  )
}

export default ReturnLink
