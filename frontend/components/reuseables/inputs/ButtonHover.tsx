"use client"

import React from "react"
import { cn } from "@/lib/utils"

export interface ButtonHoverProps {
  callback: () => void
  noHover: React.ReactNode
  hover: React.ReactNode
  disabled?: boolean
  className?: string
  variant?: "default" | "destructive" | "outline" | "ghost"
}

export function ButtonHover({
  callback,
  noHover,
  hover,
  disabled = false,
  className,
  variant = "default",
}: ButtonHoverProps) {
  const variantStyles = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    outline: "border border-border bg-transparent hover:bg-secondary",
    ghost: "bg-transparent hover:bg-secondary",
  }

  return (
    <button
      type="button"
      onClick={callback}
      disabled={disabled}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        variantStyles[variant],
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <span className="transition-opacity group-hover:opacity-0">{noHover}</span>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
        {hover}
      </span>
    </button>
  )
}

export default ButtonHover
