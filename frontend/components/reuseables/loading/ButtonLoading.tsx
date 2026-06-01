"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

export interface ButtonLoadingProps {
  className?: string
  text?: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function ButtonLoading({
  className,
  text = "Processing...",
  variant = "default",
  size = "md",
}: ButtonLoadingProps) {
  const variantStyles = {
    default: "bg-primary text-primary-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    outline: "border border-border bg-transparent text-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    ghost: "bg-transparent text-foreground",
  }

  const sizeStyles = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  }

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  }

  return (
    <div
      className={cn(
        "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-md font-medium opacity-70",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      <Loader2 className={cn("animate-spin", iconSizes[size])} />
      {text && <span>{text}</span>}
    </div>
  )
}

export default ButtonLoading
